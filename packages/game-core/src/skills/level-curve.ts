import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import type { SkillLevel } from './skill-level.js';

/**
 * Level-dependent skill values as data (ADR-031).
 *
 * A skill's numbers are curves over its level, never per-level branches in
 * code. Two shapes cover the existing numeric conventions:
 *
 * - {@link IntegerLevelCurve} for integer quantities — milliseconds and basis
 *   points: `base + perLevel × (level − 1)`, computed exactly with `bigint`.
 * - {@link HugeNumberLevelCurve} for values that scale with long-term power:
 *   `base × growth^(level − 1)`, the same form as character and stage
 *   scaling, through `HugeNumber.pow`. Never a JavaScript `number`.
 *
 * A curve is validated when it is defined, and its value is validated again
 * at every level it is resolved for: a curve that leaves its legal range at
 * some level fails there with `OUT_OF_RANGE` (or `OVERFLOW`) instead of being
 * clamped.
 */
export interface IntegerLevelCurve {
  /** Value at level 1. */
  readonly base: number;
  /** Change per level above 1. Zero is a constant; negative values decrease. */
  readonly perLevel: number;
}

export interface HugeNumberLevelCurve {
  /** Value at level 1. Non-negative. */
  readonly base: HugeNumber;
  /** Per-level multiplier. Positive; `1` is a constant. */
  readonly growth: HugeNumber;
}

/** Inclusive integer bounds a resolved value must respect. */
export interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

function requireSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new GameCoreError('NOT_A_SAFE_INTEGER', `${field} must be a safe integer.`);
  }
}

/** Copies, validates and freezes an integer curve. */
export function createIntegerLevelCurve(
  curve: IntegerLevelCurve,
  field: string,
): IntegerLevelCurve {
  requireSafeInteger(curve.base, `${field}.base`);
  requireSafeInteger(curve.perLevel, `${field}.perLevel`);
  return Object.freeze({ base: curve.base, perLevel: curve.perLevel });
}

/** Copies, validates and freezes a HugeNumber curve. */
export function createHugeNumberLevelCurve(
  curve: HugeNumberLevelCurve,
  field: string,
): HugeNumberLevelCurve {
  curve.base.ensureNonNegative(`${field}.base`);
  if (curve.growth.sign() !== 1) {
    throw new GameCoreError('INVALID_ARGUMENT', `${field}.growth must be positive.`);
  }
  return Object.freeze({ base: curve.base, growth: curve.growth });
}

/**
 * The curve's value at `level`, exact.
 *
 * @throws {GameCoreError} `OUT_OF_RANGE` if the value leaves `range`.
 */
export function integerCurveAt(
  curve: IntegerLevelCurve,
  level: SkillLevel,
  range: IntegerRange,
  field: string,
): number {
  const value = BigInt(curve.base) + BigInt(curve.perLevel) * BigInt(level.toNumber() - 1);
  if (value < BigInt(range.min) || value > BigInt(range.max)) {
    throw new GameCoreError(
      'OUT_OF_RANGE',
      `${field} at skill level ${String(level.toNumber())} must be from ${String(range.min)} to ${String(range.max)}.`,
    );
  }
  return Number(value);
}

/**
 * The curve's value at `level`, with HugeNumber rounding (half-to-even).
 *
 * @throws {GameCoreError} `OVERFLOW` beyond the HugeNumber range.
 */
export function hugeNumberCurveAt(curve: HugeNumberLevelCurve, level: SkillLevel): HugeNumber {
  return curve.base.mul(curve.growth.pow(level.toNumber() - 1));
}
