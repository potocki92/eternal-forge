import { Application, Container, Graphics, Text, type Ticker } from 'pixi.js';
import type { CombatOutcomeDto } from '@eternal-forge/contracts';
import type { CombatScene, CombatSceneOptions, SceneEncounter, SceneHit } from '../combat-scene';
import { enemyLookFor, SCENE_PALETTE as palette, type EnemyLook } from './scene-looks';

/**
 * PixiJS rendering of a combat the server already resolved (ADR-007).
 *
 * Procedural placeholders, no art assets: the hero and each enemy archetype
 * are drawn from a small data table (`scene-looks`), so real sprites can
 * replace them later without touching the animation code. Every transient
 * object — damage numbers, particles — is destroyed when its animation ends,
 * and `destroy()` releases the renderer, the WebGL context, the ticker
 * callback and the resize listener.
 */

interface Tween {
  /** The object animated; the tween is dropped once it is destroyed. */
  readonly owner: Container;
  elapsed: number;
  readonly duration: number;
  readonly update: (progress: number) => void;
  readonly complete?: () => void;
}

interface Particle {
  readonly view: Graphics;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
}

const LUNGE_MS = 180;
const FLASH_MS = 140;
const FLOAT_MS = 900;
const DEATH_MS = 480;
const ENTRANCE_MS = 520;
const BOSS_ENTRANCE_MS = 900;

/**
 * Canvas pixels covered by the DOM overlays (enemy nameplate and health bar at
 * the top, the hero's at the bottom). Actors are laid out between them, so the
 * DOM never hides the scene and the scene never hides the DOM.
 */
const OVERLAY_TOP = 84;
const OVERLAY_BOTTOM = 84;

export async function createPixiCombatScene(
  host: HTMLElement,
  options: CombatSceneOptions,
): Promise<CombatScene> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    // WebGL where available; the 2D canvas renderer otherwise.
    preference: ['webgl', 'canvas'],
  });
  app.canvas.setAttribute('aria-hidden', 'true');
  app.canvas.style.display = 'block';
  app.canvas.style.width = '100%';
  app.canvas.style.height = '100%';
  host.appendChild(app.canvas);
  return new PixiCombatScene(app, options);
}

class PixiCombatScene implements CombatScene {
  private readonly world = new Container();
  private readonly backdrop = new Graphics();
  private readonly vignette = new Graphics();
  private readonly fx = new Container();
  private readonly hero: Container;
  private enemy: Container | undefined;
  private enemyAura: Graphics | undefined;
  private enemyLook: EnemyLook = enemyLookFor('husk', 'REGULAR');
  private tweens: Tween[] = [];
  private particles: Particle[] = [];
  private shakeMs = 0;
  private shakeStrength = 0;
  private clockMs = 0;
  private destroyed = false;
  /** Where layout places each actor; animations always return here. */
  private readonly homes = new Map<Container, { x: number; y: number }>();

  constructor(
    private readonly app: Application,
    private readonly options: CombatSceneOptions,
  ) {
    this.hero = drawHero();
    this.vignette.alpha = 0;
    this.world.addChild(this.backdrop, this.hero, this.fx);
    app.stage.addChild(this.world, this.vignette);
    this.layout();
    app.renderer.on('resize', this.layout);
    app.ticker.add(this.tick);
  }

  showEncounter(encounter: SceneEncounter, { entrance }: { readonly entrance: boolean }): void {
    if (this.destroyed) {
      return;
    }
    this.clearEnemy();
    this.resetHero();
    this.fade(this.vignette, 0, 200);

    this.enemyLook = enemyLookFor(encounter.archetypeId, encounter.stageKind);
    const { view, aura } = drawEnemy(this.enemyLook);
    this.enemy = view;
    this.enemyAura = aura;
    this.world.addChildAt(view, 1);
    this.layout();

    if (!entrance || this.options.reducedMotion) {
      return;
    }
    const isBoss = encounter.stageKind === 'BOSS';
    const target = view.position.y;
    const scale = view.scale.x;
    view.alpha = 0;
    view.position.y = target - this.unit() * (isBoss ? 1.2 : 0.6);
    this.animate(view, isBoss ? BOSS_ENTRANCE_MS : ENTRANCE_MS, (t) => {
      const eased = easeOutBack(t);
      view.alpha = Math.min(1, t * 2);
      view.position.y = target - (1 - eased) * this.unit() * (isBoss ? 1.2 : 0.6);
      view.scale.set(scale * (isBoss ? 0.6 + 0.4 * eased : 1));
    });
    if (isBoss) {
      this.shake(BOSS_ENTRANCE_MS, 0.12);
    }
  }

  playHit(hit: SceneHit): void {
    const enemy = this.enemy;
    if (this.destroyed || enemy === undefined) {
      return;
    }
    const attacker = hit.attacker === 'PLAYER' ? this.hero : enemy;
    const defender = hit.attacker === 'PLAYER' ? enemy : this.hero;

    this.lunge(attacker, defender);
    this.flash(defender, hit.critical);
    this.floatText(defender, hit);
    if (hit.critical) {
      this.shake(220, 0.08);
      this.burst(defender.position.x, defender.position.y, palette.critical, 14);
    }
    if (hit.lethal) {
      this.die(defender);
    }
  }

  showOutcome(outcome: CombatOutcomeDto): void {
    if (this.destroyed) {
      return;
    }
    if (outcome === 'WIN') {
      this.burst(this.hero.position.x, this.hero.position.y, palette.victory, 28);
      return;
    }
    this.vignette.clear();
    this.vignette
      .rect(0, 0, this.app.screen.width, this.app.screen.height)
      .fill({ color: palette.defeat, alpha: 1 });
    this.fade(this.vignette, 0.28, 450);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.layout);
    this.tweens = [];
    this.particles = [];
    this.app.destroy(
      { removeView: true },
      { children: true, texture: true, textureSource: true, context: true },
    );
  }

  // --- Animation primitives -----------------------------------------------

  private readonly tick = (ticker: Ticker): void => {
    const delta = ticker.deltaMS;
    this.clockMs += delta;

    const running = this.tweens;
    this.tweens = [];
    for (const tween of running) {
      if (tween.owner.destroyed) {
        continue;
      }
      tween.elapsed = Math.min(tween.duration, tween.elapsed + delta);
      tween.update(tween.elapsed / tween.duration);
      if (tween.elapsed < tween.duration) {
        this.tweens.push(tween);
      } else {
        tween.complete?.();
      }
    }

    this.particles = this.particles.filter((particle) => {
      particle.life -= delta;
      if (particle.life <= 0) {
        particle.view.destroy();
        return false;
      }
      particle.view.position.x += (particle.vx * delta) / 1000;
      particle.view.position.y += (particle.vy * delta) / 1000;
      particle.vy += (600 * delta) / 1000;
      particle.view.alpha = particle.life / particle.maxLife;
      return true;
    });

    this.idle();
    this.applyShake(delta);
  };

  private animate(
    owner: Container,
    duration: number,
    update: (t: number) => void,
    complete?: () => void,
  ): void {
    if (this.options.reducedMotion) {
      update(1);
      complete?.();
      return;
    }
    this.tweens.push({ owner, elapsed: 0, duration, update, ...(complete ? { complete } : {}) });
  }

  private fade(view: Container, to: number, duration: number): void {
    const from = view.alpha;
    this.animate(view, duration, (t) => {
      view.alpha = from + (to - from) * t;
    });
  }

  private lunge(attacker: Container, defender: Container): void {
    // From the layout home, not the current position, so overlapping
    // lunges at high attack speed never drift.
    const origin = this.homes.get(attacker) ?? { x: attacker.position.x, y: attacker.position.y };
    const target = this.homes.get(defender) ?? { x: defender.position.x, y: defender.position.y };
    const dx = (target.x - origin.x) * 0.22;
    const dy = (target.y - origin.y) * 0.22;
    this.animate(
      attacker,
      LUNGE_MS,
      (t) => {
        const reach = Math.sin(Math.PI * t);
        attacker.position.set(origin.x + dx * reach, origin.y + dy * reach);
      },
      () => {
        attacker.position.set(origin.x, origin.y);
      },
    );
  }

  private flash(defender: Container, critical: boolean): void {
    const overlay = defender.getChildByLabel('flash');
    if (overlay === null) {
      return;
    }
    this.animate(overlay, critical ? FLASH_MS * 1.6 : FLASH_MS, (t) => {
      overlay.alpha = (1 - t) * (critical ? 0.95 : 0.7);
    });
  }

  private floatText(defender: Container, hit: SceneHit): void {
    const text = new Text({
      text: hit.critical ? `${hit.damageLabel}!` : hit.damageLabel,
      style: {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: Math.round(this.unit() * (hit.critical ? 0.42 : 0.3)),
        fontWeight: '800',
        fill: hit.critical
          ? palette.critical
          : hit.attacker === 'PLAYER'
            ? palette.damageDealt
            : palette.damageTaken,
        stroke: { color: palette.textStroke, width: 4 },
      },
    });
    text.anchor.set(0.5);
    const startX = defender.position.x + (this.clockMs % 2 === 0 ? -1 : 1) * this.unit() * 0.25;
    const startY = defender.position.y - this.unit() * 0.6;
    text.position.set(startX, startY);
    this.fx.addChild(text);

    const rise = this.unit() * 0.7;
    const finish = (): void => {
      text.destroy();
    };
    if (this.options.reducedMotion) {
      // Still shown, briefly, without movement.
      this.tweens.push({
        owner: text,
        elapsed: 0,
        duration: FLOAT_MS,
        update: () => undefined,
        complete: finish,
      });
      return;
    }
    this.animate(
      text,
      FLOAT_MS,
      (t) => {
        text.position.y = startY - rise * easeOutCubic(t);
        text.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        text.scale.set(hit.critical ? 1 + 0.4 * (1 - t) : 1);
      },
      finish,
    );
  }

  private die(defender: Container): void {
    const startY = defender.position.y;
    const startScale = defender.scale.x;
    this.animate(defender, DEATH_MS, (t) => {
      defender.alpha = 1 - t;
      defender.scale.set(startScale * (1 - 0.35 * t));
      defender.position.y = startY + this.unit() * 0.3 * t;
    });
  }

  private burst(x: number, y: number, color: number, count: number): void {
    if (this.options.reducedMotion) {
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const speed = this.unit() * (1.2 + (index % 3) * 0.6);
      const view = new Graphics().circle(0, 0, 3 + (index % 3)).fill({ color });
      view.position.set(x, y);
      this.fx.addChild(view);
      this.particles.push({
        view,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - this.unit(),
        life: 700,
        maxLife: 700,
      });
    }
  }

  private shake(duration: number, strength: number): void {
    if (this.options.reducedMotion) {
      return;
    }
    this.shakeMs = Math.max(this.shakeMs, duration);
    this.shakeStrength = strength;
  }

  private applyShake(delta: number): void {
    if (this.shakeMs <= 0) {
      this.world.position.set(0, 0);
      return;
    }
    this.shakeMs = Math.max(0, this.shakeMs - delta);
    const amplitude = this.unit() * this.shakeStrength;
    this.world.position.set(
      Math.sin(this.clockMs * 0.09) * amplitude,
      Math.cos(this.clockMs * 0.11) * amplitude,
    );
  }

  private idle(): void {
    if (this.options.reducedMotion) {
      return;
    }
    const breathe = Math.sin(this.clockMs / 420);
    this.hero.pivot.y = breathe * this.unit() * 0.04;
    if (this.enemy !== undefined) {
      this.enemy.pivot.y = -breathe * this.unit() * 0.05;
    }
    if (this.enemyAura !== undefined) {
      this.enemyAura.alpha = 0.35 + 0.2 * Math.sin(this.clockMs / 260);
    }
  }

  // --- Layout and state ---------------------------------------------------

  /** The area between the DOM overlays, where the actors stand. */
  private playArea(): { top: number; height: number } {
    const { height } = this.app.screen;
    const top = Math.min(OVERLAY_TOP, height * 0.2);
    const bottom = Math.min(OVERLAY_BOTTOM, height * 0.2);
    return { top, height: Math.max(1, height - top - bottom) };
  }

  /**
   * One layout unit: a fifth of the play area's smaller side. At that size a
   * boss (crown to aura, about 1.7 units) and the hero (about 1.3 units) fit
   * the play area at any aspect ratio without touching.
   */
  private unit(): number {
    return Math.min(this.app.screen.width, this.playArea().height) / 5;
  }

  private readonly layout = (): void => {
    const { width, height } = this.app.screen;
    const unit = this.unit();
    const area = this.playArea();
    const enemyY = area.top + area.height * 0.4;
    const heroY = area.top + area.height * 0.9;
    this.backdrop.clear();
    this.backdrop
      .ellipse(width / 2, heroY, Math.min(width * 0.42, unit * 2.4), unit * 0.3)
      .fill({ color: palette.ground, alpha: 0.55 })
      .ellipse(width / 2, enemyY + unit * 0.2, Math.min(width * 0.34, unit * 2), unit * 0.24)
      .fill({ color: palette.ground, alpha: 0.35 });
    this.place(this.hero, width / 2, heroY, unit / 60);
    if (this.enemy !== undefined) {
      this.place(this.enemy, width / 2, enemyY, (unit / 60) * this.enemyLook.scale);
    }
    if (this.vignette.alpha > 0) {
      this.vignette.clear();
      this.vignette.rect(0, 0, width, height).fill({ color: palette.defeat, alpha: 1 });
    }
  };

  private place(actor: Container, x: number, y: number, scale: number): void {
    this.homes.set(actor, { x, y });
    actor.position.set(x, y);
    actor.scale.set(scale);
  }

  private resetHero(): void {
    this.hero.alpha = 1;
    this.layout();
  }

  private clearEnemy(): void {
    if (this.enemy === undefined) {
      return;
    }
    this.world.removeChild(this.enemy);
    this.homes.delete(this.enemy);
    this.enemy.destroy({ children: true });
    this.enemy = undefined;
    this.enemyAura = undefined;
  }
}

// --- Drawing ----------------------------------------------------------------

function drawHero(): Container {
  const hero = new Container({ label: 'hero' });
  const body = new Graphics()
    // Cape
    .poly([-16, -30, 16, -30, 22, 18, -22, 18])
    .fill({ color: palette.heroCape })
    // Body
    .roundRect(-13, -32, 26, 40, 8)
    .fill({ color: palette.heroArmor })
    .stroke({ width: 2, color: palette.outline })
    // Head
    .circle(0, -42, 11)
    .fill({ color: palette.heroSkin })
    .stroke({ width: 2, color: palette.outline })
    // Sword
    .roundRect(15, -58, 5, 42, 2)
    .fill({ color: palette.heroSteel })
    .rect(9, -18, 17, 4)
    .fill({ color: palette.heroCape });
  const flash = new Graphics({ label: 'flash' })
    .roundRect(-15, -54, 30, 64, 10)
    .fill({ color: palette.flash });
  flash.alpha = 0;
  hero.addChild(body, flash);
  return hero;
}

function drawEnemy(look: EnemyLook): { view: Container; aura: Graphics | undefined } {
  const view = new Container({ label: 'enemy' });
  let aura: Graphics | undefined;
  if (look.aura !== undefined) {
    aura = new Graphics().circle(0, -22, 46).fill({ color: look.aura, alpha: 0.55 });
    view.addChild(aura);
  }
  const body = new Graphics();
  for (let index = 0; index < look.spikes; index += 1) {
    const angle = Math.PI + (index / Math.max(1, look.spikes - 1)) * Math.PI;
    const x = Math.cos(angle) * 30;
    const y = -22 + Math.sin(angle) * 30;
    body
      .poly([x - 6, y, x + 6, y, x + Math.cos(angle) * 16, y + Math.sin(angle) * 16])
      .fill({ color: look.horn });
  }
  body
    .ellipse(0, -22, 30, 28)
    .fill({ color: look.body })
    .stroke({ width: 2, color: palette.outline })
    .circle(-10, -26, 5)
    .fill({ color: look.eye })
    .circle(10, -26, 5)
    .fill({ color: look.eye })
    .roundRect(-12, -10, 24, 4, 2)
    .fill({ color: palette.outline });
  const flash = new Graphics({ label: 'flash' })
    .ellipse(0, -22, 32, 30)
    .fill({ color: palette.flash });
  flash.alpha = 0;
  view.addChild(body, flash);
  return { view, aura };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
