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

export function createCharacter(level: number, rules: GameRules): Character {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      'Character level must be a safe integer of at least 1.',
    );
  }
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
