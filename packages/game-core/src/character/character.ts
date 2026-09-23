import { GameCoreError } from '../errors.js';
import type { GameRules } from '../rules/index.js';
import type { CombatStats } from '../stats/combat-stats.js';

/**
 * The player's character as combat sees it.
 *
 * Phase 1 derives stats from level alone. Equipment, affixes, skills and
 * passives (Phases 5–8) will contribute further modifiers through the effect
 * system; they are deliberately absent here.
 */
export interface Character {
  readonly level: number;
  readonly stats: CombatStats;
}

/**
 * Highest character level: the PostgreSQL `integer` maximum, `2^31 − 1`, so
 * every level fits its column exactly. Under `RULES_V1` the experience needed
 * to get anywhere near it is itself far beyond any reachable reward, so the
 * cap exists to make the bound explicit rather than to shape play.
 */
export const CHARACTER_LEVEL_MAX = 2_147_483_647;

/** @throws {GameCoreError} `INVALID_ARGUMENT` unless `level` is an integer from 1 to the maximum. */
export function validateLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > CHARACTER_LEVEL_MAX) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Character level must be an integer from 1 to ${CHARACTER_LEVEL_MAX}.`,
    );
  }
  return level;
}

export function createCharacter(level: number, rules: GameRules): Character {
  validateLevel(level);
  const { baseStats, healthGrowthPerLevel, damageGrowthPerLevel } = rules.character;
  return {
    level,
    stats: {
      ...baseStats,
      maxHealth: baseStats.maxHealth.mul(healthGrowthPerLevel.pow(level - 1)),
      damage: baseStats.damage.mul(damageGrowthPerLevel.pow(level - 1)),
    },
  };
}
