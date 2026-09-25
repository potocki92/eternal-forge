import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import type { GameRules } from '../rules/index.js';
import { BASIS_POINTS } from '../stats/combat-stats.js';

const CHARACTER_LEVEL_MAX = 2_147_483_647;

/** Stable identifiers for the values the current combat model consumes. */
export const CHARACTER_STAT_IDS = [
  'MAX_HEALTH',
  'DAMAGE',
  'ATTACK_SPEED',
  'CRITICAL_CHANCE',
  'CRITICAL_DAMAGE',
] as const;

export type CharacterStatId = (typeof CHARACTER_STAT_IDS)[number];

/**
 * Canonical character values before or after modifier resolution.
 *
 * Health and damage use HugeNumber. Rates use integer basis points, where
 * 10,000 is 100%; attack speed uses 10,000 for one attack per second.
 */
export interface CharacterStats {
  readonly maxHealth: HugeNumber;
  readonly damage: HugeNumber;
  readonly attackSpeedBp: number;
  readonly criticalChanceBp: number;
  readonly criticalDamageBp: number;
}

export type BaseCharacterStats = CharacterStats;
export type ResolvedCharacterStats = CharacterStats;

export const CHARACTER_STAT_MINIMUMS = Object.freeze({
  maxHealth: HugeNumber.ONE,
  damage: HugeNumber.ZERO,
  attackSpeedBp: 1,
  criticalChanceBp: 0,
  criticalDamageBp: BASIS_POINTS,
});

export const CHARACTER_CRITICAL_CHANCE_MAX_BP = BASIS_POINTS;

/**
 * Derives the current rules version's level-only source stats.
 *
 * Supplying the rule set makes the version input explicit. The function does
 * no I/O and does not inspect the current GAME_RULES_VERSION.
 */
export function deriveBaseCharacterStats(level: number, rules: GameRules): BaseCharacterStats {
  if (!Number.isSafeInteger(level) || level < 1 || level > CHARACTER_LEVEL_MAX) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Character level must be an integer from 1 to ${CHARACTER_LEVEL_MAX}.`,
    );
  }

  const { baseStats, healthGrowthPerLevel, damageGrowthPerLevel } = rules.character;
  return {
    maxHealth: baseStats.maxHealth.mul(healthGrowthPerLevel.pow(level - 1)),
    damage: baseStats.damage.mul(damageGrowthPerLevel.pow(level - 1)),
    attackSpeedBp: baseStats.attackSpeedBp,
    criticalChanceBp: baseStats.critChanceBp,
    criticalDamageBp: baseStats.critDamageBp,
  };
}
