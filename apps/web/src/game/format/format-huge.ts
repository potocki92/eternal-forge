import type { HugeNumberDto } from '@eternal-forge/contracts';
import { HugeNumber } from '@eternal-forge/game-core';

/**
 * Presentation of HugeNumbers (docs/UI_SYSTEM.md — "Numbers").
 *
 * Arithmetic stays in Game Core; this module only turns the canonical wire
 * string into text and bar widths. It reads the value's exact digits
 * (`toParts`) instead of converting to a float, so large values never display
 * a rounding artefact.
 */

const SMALL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;
/** Digits of the coefficient; the value is `coefficient × 10^(exponent − 17)`. */
const PRECISION = 18;

/**
 * `"0"` → `0`, `"1.24e3"` → `1,240`, `"1.24e4"` → `12.4K`, `"5.28e6"` →
 * `5.28M`, and scientific (`1.23e15`) beyond the trillions. Three significant
 * digits, truncated rather than rounded, so a balance is never overstated.
 */
export function formatHuge(value: HugeNumberDto): string {
  const number = HugeNumber.parse(value);
  if (number.isZero()) {
    return '0';
  }
  const { coefficient, exponent } = number.toParts();
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();

  if (exponent < 4) {
    // Below 10,000: exact enough as a float, shown grouped with one decimal.
    return SMALL.format(Number(value));
  }
  if (exponent >= SUFFIXES.length * 3) {
    return `${sign}${significant(digits, 1)}e${String(exponent)}`;
  }
  const tier = Math.floor(exponent / 3);
  const integerDigits = exponent - tier * 3 + 1;
  return `${sign}${significant(digits, integerDigits)}${SUFFIXES[tier] ?? ''}`;
}

/** The first three significant digits with the point after `integerDigits`. */
function significant(digits: string, integerDigits: number): string {
  const whole = digits.slice(0, integerDigits);
  const fraction = digits.slice(integerDigits, Math.max(3, integerDigits)).replace(/0+$/u, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/**
 * `value / max` clamped to 0…1, for health and experience bars. Presentation
 * only: the fraction is a width, never an input to a rule.
 */
export function hugeRatio(value: HugeNumberDto, max: HugeNumberDto): number {
  const numerator = HugeNumber.parse(value);
  const denominator = HugeNumber.parse(max);
  if (denominator.isZero() || numerator.isZero() || numerator.isNegative()) {
    return 0;
  }
  if (numerator.gte(denominator)) {
    return 1;
  }
  const a = numerator.toParts();
  const b = denominator.toParts();
  const shift = a.exponent - b.exponent;
  if (shift < -PRECISION) {
    return 0;
  }
  return clamp((Number(a.coefficient) / Number(b.coefficient)) * 10 ** shift);
}

function clamp(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}
