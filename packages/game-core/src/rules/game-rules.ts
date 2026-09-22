import type { HugeNumber } from '../huge-number/index.js';
import type { CombatStats } from '../stats/combat-stats.js';

/**
 * A complete, versioned rule set (ADR-005, ADR-015).
 *
 * Balance lives here as data. Engine code reads a `GameRules` value and never
 * embeds a balance constant, so a balance patch is a new rule set under a new
 * version rather than an edit to the engine.
 */
export interface GameRules {
  readonly version: number;
  readonly combat: CombatRules;
  readonly character: CharacterRules;
  readonly stages: StageRules;
  readonly rewards: RewardRules;
}

export interface CombatRules {
  /** A combat still undecided at this time is lost by the player. */
  readonly timeLimitMs: number;
  /** Attack speed above this has no effect. Also bounds combat length. */
  readonly maxAttackSpeedBp: number;
  /** Critical chance above this has no effect. */
  readonly maxCritChanceBp: number;
}

export interface CharacterRules {
  /** Stats of a level-1 character. */
  readonly baseStats: CombatStats;
  /** Per-level multiplier applied to health: `base × growth^(level − 1)`. */
  readonly healthGrowthPerLevel: HugeNumber;
  /** Per-level multiplier applied to damage: `base × growth^(level − 1)`. */
  readonly damageGrowthPerLevel: HugeNumber;
}

/** Data describing a kind of enemy. Scaling by stage is applied on top. */
export interface EnemyArchetype {
  readonly id: string;
  readonly healthMultiplier: HugeNumber;
  readonly damageMultiplier: HugeNumber;
  readonly attackSpeedBp: number;
  readonly critChanceBp: number;
  readonly critDamageBp: number;
}

export interface StageRules {
  /** Every stage divisible by this is a boss stage. */
  readonly bossInterval: number;
  /** Enemy health on stage 1, before the archetype multiplier. */
  readonly baseEnemyHealth: HugeNumber;
  /** Enemy damage on stage 1, before the archetype multiplier. */
  readonly baseEnemyDamage: HugeNumber;
  /** Per-stage multiplier: `base × growth^(stage − 1)`. */
  readonly enemyHealthGrowth: HugeNumber;
  /** Per-stage multiplier: `base × growth^(stage − 1)`. */
  readonly enemyDamageGrowth: HugeNumber;
  readonly regularArchetype: EnemyArchetype;
  readonly bossArchetype: EnemyArchetype;
}

export interface RewardRules {
  readonly baseGold: HugeNumber;
  readonly goldGrowth: HugeNumber;
  readonly baseExperience: HugeNumber;
  readonly experienceGrowth: HugeNumber;
  /** Multiplier on boss-stage rewards. */
  readonly bossRewardMultiplier: HugeNumber;
}
