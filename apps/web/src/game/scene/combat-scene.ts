import type { CombatOutcomeDto, StageKind } from '@eternal-forge/contracts';

/**
 * The boundary between React and the combat renderer (ADR-007).
 *
 * React decides *what* happens and *when*, from a combat the server already
 * resolved. The scene only draws it. It receives presentation cues, holds no
 * gameplay state and computes no outcome, so it can be replaced, degraded on a
 * weak device or disabled without losing information: every cue is also
 * rendered as accessible DOM by the game screen.
 */
export interface CombatScene {
  /** Shows the enemy waiting on a stage. `entrance` animates its arrival. */
  showEncounter(encounter: SceneEncounter, options: { readonly entrance: boolean }): void;
  /** Animates one hit the server resolved. */
  playHit(hit: SceneHit): void;
  /** The combat is over: victory or defeat treatment. */
  showOutcome(outcome: CombatOutcomeDto): void;
  /** Releases the renderer, its textures, listeners and animation loop. */
  destroy(): void;
}

export interface SceneEncounter {
  /** Content id, used only to choose a look. Unknown ids get a generic one. */
  readonly archetypeId: string;
  /** Classified by the server's rule set; the scene never infers it. */
  readonly stageKind: StageKind;
}

export interface SceneHit {
  readonly attacker: 'PLAYER' | 'ENEMY';
  readonly critical: boolean;
  /** Already formatted for display, e.g. `12.4K`. */
  readonly damageLabel: string;
  /** This hit brought the defender to zero. */
  readonly lethal: boolean;
}

export interface CombatSceneOptions {
  readonly reducedMotion: boolean;
}

/**
 * Creates a scene inside `host`. May reject — no WebGL, no canvas — in which
 * case the game remains fully playable through its DOM.
 */
export type CombatSceneFactory = (
  host: HTMLElement,
  options: CombatSceneOptions,
) => Promise<CombatScene>;
