import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import type { CombatRules } from '../rules/game-rules.js';

/**
 * Scale of every rate stat. 10 000 basis points = 100% = 1.0.
 *
 * Rates are integers so that no binary floating-point value ever decides a
 * gameplay outcome.
 */
export const BASIS_POINTS = 10_000;

/**
 * The stats combat reads, shared by characters and enemies so the combat engine
 * stays generic: a new enemy or build is new data, not new engine code.
 */
export interface CombatStats {
  /** Health at the start of a combat. Positive. */
  readonly maxHealth: HugeNumber;
  /** Damage of one normal hit. Non-negative. */
  readonly damage: HugeNumber;
  /** Attacks per second, in basis points: 10 000 = one attack per second. */
  readonly attackSpeedBp: number;
  /** Chance that a hit is critical, in basis points: 500 = 5%. */
  readonly critChanceBp: number;
  /** Damage of a critical hit relative to a normal hit: 15 000 = 150%. */
  readonly critDamageBp: number;
}

function requireInteger(value: number, field: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `${field} must be a safe integer of at least ${minimum}.`,
    );
  }
}

/**
 * Rejects stats that no rule could have produced. Clamping to rule caps is a
 * separate, legitimate gameplay step (`applyCombatCaps`); invalid input is
 * never silently repaired.
 */
export function validateCombatStats(stats: CombatStats, owner: string): CombatStats {
  stats.maxHealth.ensureNonNegative(`${owner}.maxHealth`);
  if (stats.maxHealth.isZero()) {
    throw new GameCoreError('INVALID_ARGUMENT', `${owner}.maxHealth must be positive.`);
  }
  stats.damage.ensureNonNegative(`${owner}.damage`);
  requireInteger(stats.attackSpeedBp, `${owner}.attackSpeedBp`, 1);
  requireInteger(stats.critChanceBp, `${owner}.critChanceBp`, 0);
  requireInteger(stats.critDamageBp, `${owner}.critDamageBp`, BASIS_POINTS);
  return stats;
}

/**
 * Applies the rule caps: attack speed and critical chance above their caps have
 * no further effect. Builds may exceed a cap; combat uses the capped value.
 */
export function applyCombatCaps(stats: CombatStats, rules: CombatRules): CombatStats {
  return {
    ...stats,
    attackSpeedBp: Math.min(stats.attackSpeedBp, rules.maxAttackSpeedBp),
    critChanceBp: Math.min(stats.critChanceBp, rules.maxCritChanceBp),
  };
}
