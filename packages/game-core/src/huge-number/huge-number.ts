import { GameCoreError } from '../errors.js';

/**
 * Number of significant decimal digits a `HugeNumber` carries (ADR-013).
 *
 * Every integer below `10^18` is exact. Beyond that, values carry 18
 * significant digits and every operation rounds half-to-even exactly once.
 */
export const HUGE_NUMBER_PRECISION = 18;

/** Largest scientific exponent. Anything larger is a deterministic overflow. */
export const HUGE_NUMBER_MAX_EXPONENT = 2_147_483_647;

/** Smallest scientific exponent of a non-zero value. Anything smaller flushes to zero. */
export const HUGE_NUMBER_MIN_EXPONENT = -2_147_483_647;

/**
 * Exponent reserved for zero. It is the lowest signed 32-bit integer, so the
 * persisted `(exp, coef)` pair of zero sorts below every positive value.
 */
export const HUGE_NUMBER_ZERO_EXPONENT = -2_147_483_648;

const COEFFICIENT_MIN = 10n ** 17n;
const COEFFICIENT_LIMIT = 10n ** 18n;

/**
 * Canonical wire form (ADR-013, section 2). One string per value.
 *
 * Groups: 1 sign, 2 leading digit, 3 fraction digits, 4 exponent.
 */
const CANONICAL_PATTERN = /^(?:0|(-?)([1-9])(?:\.([0-9]{0,16}[1-9]))?e(0|-?[1-9][0-9]*))$/u;

/** Lenient decimal input for content data: `1500`, `1.07`, `-2.5e-3`, `.5`. */
const DECIMAL_PATTERN = /^([+-]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/u;

/** Bounds attacker-controlled parsing work; content data never needs more. */
const MAX_DECIMAL_INPUT_LENGTH = 512;
const MAX_EXPONENT_DIGITS = 15;

/**
 * Beyond this exponent gap, the smaller addend cannot move the larger one.
 *
 * If `d = e_hi − e_lo > 20`, then `|lo| < 10^(e_lo + 1) ≤ 10^(e_hi − 20)`,
 * which is below half a unit in the last place of `hi` even when a subtraction
 * drops the result into the next lower decade (`5 × 10^(e_hi − 19)`). The
 * exactly rounded sum is therefore `hi`, and no tie is possible.
 */
const ADD_EXACT_WINDOW = 20;

const POWERS_OF_TEN: bigint[] = [];

function powerOfTen(exponent: number): bigint {
  const cached = POWERS_OF_TEN[exponent];
  if (cached !== undefined) {
    return cached;
  }
  const value = 10n ** BigInt(exponent);
  if (exponent < 64) {
    POWERS_OF_TEN[exponent] = value;
  }
  return value;
}

/** `numerator / denominator` for positive operands, rounded half-to-even. */
function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) === 1n)) {
    return quotient + 1n;
  }
  return quotient;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function parseExponent(digits: string): number {
  const unsigned = digits.replace(/^[+-]/u, '');
  if (unsigned.length > MAX_EXPONENT_DIGITS) {
    throw new GameCoreError('OUT_OF_RANGE', 'HugeNumber exponent is out of range.');
  }
  return Number(digits);
}

export interface HugeNumberParts {
  /**
   * Signed coefficient. `0n` for zero, otherwise `10^17 ≤ |coefficient| < 10^18`.
   * Persisted values are non-negative (ADR-013, section 3).
   */
  readonly coefficient: bigint;
  /** Scientific exponent, or `HUGE_NUMBER_ZERO_EXPONENT` for zero. */
  readonly exponent: number;
}

/**
 * Immutable decimal value `coefficient × 10^(exponent − 17)` (ADR-013).
 *
 * The only large-number arithmetic in the project. Every operation uses
 * `bigint` arithmetic, which ECMAScript specifies exactly, and rounds its exact
 * result half-to-even once, so results are bit-identical on every engine.
 * No `Math` function is involved.
 *
 * The representation is canonical: equal values have equal fields, equal
 * `toString()` output and equal `toParts()`.
 *
 * Formatting for players (`12.4K`, `5.28M`) is presentation logic and lives in
 * the UI layer, not here.
 */
export class HugeNumber {
  public static readonly ZERO = new HugeNumber(0n, HUGE_NUMBER_ZERO_EXPONENT);
  public static readonly ONE = new HugeNumber(COEFFICIENT_MIN, 0);

  private readonly coefficient: bigint;
  private readonly exponent: number;

  private constructor(coefficient: bigint, exponent: number) {
    this.coefficient = coefficient;
    this.exponent = exponent;
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Creates a value from a safe integer. Binary fractions are refused so a
   * `float64` can never become an authoritative value by accident: pass
   * fractional content values as decimal strings to `fromDecimal`.
   */
  public static fromNumber(value: number): HugeNumber {
    if (!Number.isSafeInteger(value)) {
      throw new GameCoreError(
        'NOT_A_SAFE_INTEGER',
        'HugeNumber.fromNumber accepts only safe integers; use fromDecimal for fractions.',
      );
    }
    return HugeNumber.fromExact(BigInt(value), 0);
  }

  /** Creates a value from an integer. More than 18 digits round half-to-even. */
  public static fromBigInt(value: bigint): HugeNumber {
    return HugeNumber.fromExact(value, 0);
  }

  /**
   * Parses any plain or scientific decimal string exactly, then rounds once to
   * 18 digits. Intended for content data such as a growth factor of `"1.07"`.
   * Wire values use the strict `parse` instead.
   */
  public static fromDecimal(text: string): HugeNumber {
    if (text.length > MAX_DECIMAL_INPUT_LENGTH) {
      throw new GameCoreError('INVALID_FORMAT', 'Decimal input is too long.');
    }
    const match = DECIMAL_PATTERN.exec(text);
    const integerDigits = match?.[2] ?? '';
    const fractionDigits = match?.[3] ?? '';
    if (match === null || integerDigits.length + fractionDigits.length === 0) {
      throw new GameCoreError('INVALID_FORMAT', 'Input is not a decimal number.');
    }
    const exponent = match[4] === undefined ? 0 : parseExponent(match[4]);
    const magnitude = BigInt(integerDigits + fractionDigits);
    return HugeNumber.fromExact(
      match[1] === '-' ? -magnitude : magnitude,
      exponent - fractionDigits.length,
    );
  }

  /**
   * Parses the canonical wire form and nothing else, so
   * `HugeNumber.parse(s).toString() === s` for every accepted `s`.
   */
  public static parse(text: string): HugeNumber {
    const match = CANONICAL_PATTERN.exec(text);
    if (match === null) {
      throw new GameCoreError('INVALID_FORMAT', 'Input is not a canonical HugeNumber.');
    }
    const leading = match[2];
    const exponentDigits = match[4];
    if (leading === undefined || exponentDigits === undefined) {
      return HugeNumber.ZERO;
    }
    const exponent = parseExponent(exponentDigits);
    if (exponent < HUGE_NUMBER_MIN_EXPONENT || exponent > HUGE_NUMBER_MAX_EXPONENT) {
      throw new GameCoreError('OUT_OF_RANGE', 'HugeNumber exponent is out of range.');
    }
    const digits = (leading + (match[3] ?? '')).padEnd(HUGE_NUMBER_PRECISION, '0');
    const magnitude = BigInt(digits);
    return new HugeNumber(match[1] === '-' ? -magnitude : magnitude, exponent);
  }

  /** Whether `text` is a canonical HugeNumber within range. */
  public static isCanonical(text: string): boolean {
    try {
      HugeNumber.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rebuilds a value from its normalised parts, such as the two persisted
   * columns. Non-normalised input is rejected rather than repaired, because it
   * indicates corrupted storage.
   */
  public static fromParts(coefficient: bigint, exponent: number): HugeNumber {
    if (coefficient === 0n) {
      if (exponent !== HUGE_NUMBER_ZERO_EXPONENT) {
        throw new GameCoreError('INVALID_ARGUMENT', 'Zero must use the zero exponent sentinel.');
      }
      return HugeNumber.ZERO;
    }
    const magnitude = absolute(coefficient);
    if (magnitude < COEFFICIENT_MIN || magnitude >= COEFFICIENT_LIMIT) {
      throw new GameCoreError('INVALID_ARGUMENT', 'Coefficient is not normalised to 18 digits.');
    }
    if (
      !Number.isInteger(exponent) ||
      exponent < HUGE_NUMBER_MIN_EXPONENT ||
      exponent > HUGE_NUMBER_MAX_EXPONENT
    ) {
      throw new GameCoreError('OUT_OF_RANGE', 'HugeNumber exponent is out of range.');
    }
    return new HugeNumber(coefficient, exponent);
  }

  public static min(first: HugeNumber, second: HugeNumber): HugeNumber {
    return first.compare(second) <= 0 ? first : second;
  }

  public static max(first: HugeNumber, second: HugeNumber): HugeNumber {
    return first.compare(second) >= 0 ? first : second;
  }

  /**
   * The single normalisation and rounding step. `significand × 10^scale` is the
   * exact result of an operation; it is rounded half-to-even to 18 digits,
   * checked against the exponent range and returned.
   */
  private static fromExact(significand: bigint, scale: number): HugeNumber {
    if (significand === 0n) {
      return HugeNumber.ZERO;
    }
    const negative = significand < 0n;
    let magnitude = negative ? -significand : significand;
    let unitScale = scale;
    const digits = magnitude.toString().length;

    if (digits > HUGE_NUMBER_PRECISION) {
      const shift = digits - HUGE_NUMBER_PRECISION;
      magnitude = divideRoundHalfEven(magnitude, powerOfTen(shift));
      unitScale += shift;
      if (magnitude === COEFFICIENT_LIMIT) {
        // 999…9.5 rounded up to the next decade; dividing by ten is exact.
        magnitude = COEFFICIENT_MIN;
        unitScale += 1;
      }
    } else if (digits < HUGE_NUMBER_PRECISION) {
      const shift = HUGE_NUMBER_PRECISION - digits;
      magnitude *= powerOfTen(shift);
      unitScale -= shift;
    }

    const exponent = unitScale + HUGE_NUMBER_PRECISION - 1;
    if (exponent > HUGE_NUMBER_MAX_EXPONENT) {
      throw new GameCoreError('OVERFLOW', 'HugeNumber overflow: exponent exceeds 2^31 - 1.');
    }
    if (exponent < HUGE_NUMBER_MIN_EXPONENT) {
      return HugeNumber.ZERO;
    }
    return new HugeNumber(negative ? -magnitude : magnitude, exponent);
  }

  // ---------------------------------------------------------------------------
  // Arithmetic
  // ---------------------------------------------------------------------------

  public add(other: HugeNumber): HugeNumber {
    if (other.coefficient === 0n) {
      return this;
    }
    if (this.coefficient === 0n) {
      return other;
    }
    const [high, low] = this.exponent >= other.exponent ? [this, other] : [other, this];
    const gap = high.exponent - low.exponent;
    if (gap > ADD_EXACT_WINDOW) {
      return high;
    }
    return HugeNumber.fromExact(
      high.coefficient * powerOfTen(gap) + low.coefficient,
      low.exponent - (HUGE_NUMBER_PRECISION - 1),
    );
  }

  public sub(other: HugeNumber): HugeNumber {
    return this.add(other.neg());
  }

  public mul(other: HugeNumber): HugeNumber {
    if (this.coefficient === 0n || other.coefficient === 0n) {
      return HugeNumber.ZERO;
    }
    return HugeNumber.fromExact(
      this.coefficient * other.coefficient,
      this.exponent + other.exponent - 2 * (HUGE_NUMBER_PRECISION - 1),
    );
  }

  /** Correctly rounded quotient. Division by zero is an error, never `Infinity`. */
  public div(other: HugeNumber): HugeNumber {
    if (other.coefficient === 0n) {
      throw new GameCoreError('DIVISION_BY_ZERO', 'HugeNumber division by zero.');
    }
    if (this.coefficient === 0n) {
      return HugeNumber.ZERO;
    }
    const dividend = absolute(this.coefficient);
    const divisor = absolute(other.coefficient);
    // Both magnitudes have 18 digits, so their ratio lies in (0.1, 10). Scaling
    // by 10^17 or 10^18 yields a quotient of exactly 18 digits, which a single
    // half-to-even step then rounds correctly using the full remainder.
    const scale = dividend >= divisor ? HUGE_NUMBER_PRECISION - 1 : HUGE_NUMBER_PRECISION;
    const quotient = divideRoundHalfEven(dividend * powerOfTen(scale), divisor);
    const negative = this.coefficient < 0n !== other.coefficient < 0n;
    return HugeNumber.fromExact(
      negative ? -quotient : quotient,
      this.exponent - other.exponent - scale,
    );
  }

  /**
   * Integer power by square-and-multiply, least significant bit first.
   *
   * Each multiplication rounds, so the sequence of multiplications is part of
   * the game rules (ADR-013): do not change the algorithm without bumping
   * `GAME_RULES_VERSION`. The base is not squared after the last bit, so an
   * unused square can never overflow.
   *
   * A `bigint` power is exact at any size (stage numbers use it, ADR-018); a
   * `number` power must be a safe integer. Both run the same sequence of
   * multiplications, one per bit.
   */
  public pow(power: number | bigint): HugeNumber {
    if (typeof power === 'number' && !Number.isSafeInteger(power)) {
      throw new GameCoreError('INVALID_ARGUMENT', 'Power must be a non-negative safe integer.');
    }
    const exact = BigInt(power);
    if (exact < 0n) {
      throw new GameCoreError('INVALID_ARGUMENT', 'Power must be a non-negative integer.');
    }
    return HugeNumber.power(this, exact);
  }

  private static power(initialBase: HugeNumber, power: bigint): HugeNumber {
    let result = HugeNumber.ONE;
    let base = initialBase;
    let remaining = power;
    while (remaining > 0n) {
      if ((remaining & 1n) === 1n) {
        result = result.mul(base);
      }
      remaining >>= 1n;
      if (remaining > 0n) {
        base = base.mul(base);
      }
    }
    return result;
  }

  public neg(): HugeNumber {
    return this.coefficient === 0n ? this : new HugeNumber(-this.coefficient, this.exponent);
  }

  public abs(): HugeNumber {
    return this.coefficient < 0n ? this.neg() : this;
  }

  /** Largest integer not greater than this value. */
  public floor(): HugeNumber {
    if (this.coefficient === 0n || this.exponent >= HUGE_NUMBER_PRECISION - 1) {
      return this;
    }
    if (this.exponent < 0) {
      return this.coefficient > 0n ? HugeNumber.ZERO : HugeNumber.ONE.neg();
    }
    const unit = powerOfTen(HUGE_NUMBER_PRECISION - 1 - this.exponent);
    const magnitude = absolute(this.coefficient);
    const truncated = (magnitude / unit) * unit;
    if (this.coefficient > 0n) {
      return new HugeNumber(truncated, this.exponent);
    }
    const roundedAway = truncated === magnitude ? truncated : truncated + unit;
    return HugeNumber.fromExact(-roundedAway, this.exponent - (HUGE_NUMBER_PRECISION - 1));
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  /** Exact total order: `-1`, `0` or `1`. */
  public compare(other: HugeNumber): -1 | 0 | 1 {
    const sign = this.sign();
    const otherSign = other.sign();
    if (sign !== otherSign) {
      return sign < otherSign ? -1 : 1;
    }
    if (sign === 0) {
      return 0;
    }
    if (this.exponent !== other.exponent) {
      const larger = this.exponent > other.exponent;
      return larger === sign > 0 ? 1 : -1;
    }
    // Equal exponents: the signed coefficients order exactly like the values.
    if (this.coefficient === other.coefficient) {
      return 0;
    }
    return this.coefficient < other.coefficient ? -1 : 1;
  }

  public eq(other: HugeNumber): boolean {
    return this.coefficient === other.coefficient && this.exponent === other.exponent;
  }

  public lt(other: HugeNumber): boolean {
    return this.compare(other) < 0;
  }

  public lte(other: HugeNumber): boolean {
    return this.compare(other) <= 0;
  }

  public gt(other: HugeNumber): boolean {
    return this.compare(other) > 0;
  }

  public gte(other: HugeNumber): boolean {
    return this.compare(other) >= 0;
  }

  public sign(): -1 | 0 | 1 {
    if (this.coefficient === 0n) {
      return 0;
    }
    return this.coefficient > 0n ? 1 : -1;
  }

  public isZero(): boolean {
    return this.coefficient === 0n;
  }

  public isNegative(): boolean {
    return this.coefficient < 0n;
  }

  public isInteger(): boolean {
    if (this.coefficient === 0n || this.exponent >= HUGE_NUMBER_PRECISION - 1) {
      return true;
    }
    if (this.exponent < 0) {
      return false;
    }
    return this.coefficient % powerOfTen(HUGE_NUMBER_PRECISION - 1 - this.exponent) === 0n;
  }

  /**
   * Returns this value, or throws `NEGATIVE_VALUE` naming `field`. Domain
   * quantities such as health, damage and rewards are never negative.
   */
  public ensureNonNegative(field: string): this {
    if (this.coefficient < 0n) {
      throw new GameCoreError('NEGATIVE_VALUE', `${field} must not be negative.`);
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  /** The canonical wire form (ADR-013, section 2). */
  public toString(): string {
    if (this.coefficient === 0n) {
      return '0';
    }
    const digits = absolute(this.coefficient).toString();
    const fraction = digits.slice(1).replace(/0+$/u, '');
    const sign = this.coefficient < 0n ? '-' : '';
    return `${sign}${digits.charAt(0)}${fraction === '' ? '' : `.${fraction}`}e${this.exponent}`;
  }

  /** Serialises as the canonical string, never as a JSON number. */
  public toJSON(): string {
    return this.toString();
  }

  /** The normalised parts, matching the two persisted columns (ADR-013, section 3). */
  public toParts(): HugeNumberParts {
    return { coefficient: this.coefficient, exponent: this.exponent };
  }
}
