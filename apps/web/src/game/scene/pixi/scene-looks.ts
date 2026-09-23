import type { StageKind } from '@eternal-forge/contracts';

/**
 * Visual data for the procedural combat scene.
 *
 * Canvas colours cannot read the CSS design tokens (packages/ui) directly, so
 * this is the scene's single palette, chosen to match them: surfaces from the
 * dark-fantasy background family, the hero from `primary`, critical hits from
 * `warning`, defeat from `danger`. Changing art direction means changing this
 * file, not the animation code.
 */
export const SCENE_PALETTE = {
  ground: 0x2a2540,
  outline: 0x0e0c16,
  flash: 0xffffff,
  heroArmor: 0x8c93a8,
  heroSteel: 0xd9dee8,
  heroCape: 0xe07b2e,
  heroSkin: 0xe8c39e,
  damageDealt: 0xf4f1ea,
  damageTaken: 0xff6b5e,
  critical: 0xffd23f,
  victory: 0xffc857,
  defeat: 0x8a1a1a,
  textStroke: 0x0b0d14,
} as const;

export interface EnemyLook {
  readonly body: number;
  readonly eye: number;
  readonly horn: number;
  readonly spikes: number;
  /** Relative size; bosses are larger. */
  readonly scale: number;
  /** A pulsing glow behind the enemy, used for bosses. */
  readonly aura: number | undefined;
}

const HUSK: EnemyLook = {
  body: 0x6b5a4a,
  eye: 0xffd27a,
  horn: 0x4a3d32,
  spikes: 0,
  scale: 1,
  aura: undefined,
};

/** Looks keyed by enemy archetype id. Content ids are data, not code paths. */
const LOOKS: Readonly<Record<string, EnemyLook>> = {
  husk: HUSK,
  warden: { body: 0x3b2352, eye: 0xff4d4d, horn: 0xc9b37e, spikes: 7, scale: 1.45, aura: 0xb03030 },
};

/** Any archetype without a dedicated look. */
const FALLBACK = HUSK;

/**
 * The look for an archetype. A boss stage always gets the boss treatment —
 * size and aura — even for an archetype without a dedicated look, because the
 * server said it is a boss.
 */
export function enemyLookFor(archetypeId: string, stageKind: StageKind): EnemyLook {
  const look = LOOKS[archetypeId] ?? FALLBACK;
  if (stageKind !== 'BOSS') {
    return look;
  }
  return {
    ...look,
    scale: Math.max(look.scale, 1.4),
    aura: look.aura ?? 0xb03030,
    spikes: Math.max(look.spikes, 5),
  };
}
