import { GameCoreError } from '../errors.js';

/**
 * Largest stage number: the largest PostgreSQL `bigint`, `2^63 − 1`.
 *
 * Stages are "effectively unlimited" (docs/GAME_DESIGN.md), not literally
 * unbounded. This ceiling lets every stage number be stored exactly in the
 * `bigint` column and sit on the wire as at most 19 digits. It is ~10^9 times
 * the safe-integer range, and no v1 rule set can even scale an enemy that far
 * before `HugeNumber` overflows (ADR-018).
 */
export const STAGE_NUMBER_MAX = 9_223_372_036_854_775_807n;

/**
 * Canonical decimal form: no sign, no leading zero, no exponent, no separators,
 * 1 to 19 digits. The upper bound is then checked exactly as a `bigint`.
 */
const CANONICAL_PATTERN = /^[1-9][0-9]{0,18}$/u;

function outOfRange(): GameCoreError {
  return new GameCoreError('OUT_OF_RANGE', `Stage number must be from 1 to ${STAGE_NUMBER_MAX}.`);
}

/**
 * A position on the stage ladder: a whole number from 1 to
 * {@link STAGE_NUMBER_MAX} (ADR-018).
 *
 * Stored as a `bigint`, so it is exact across its whole range and every
 * comparison and step is integer arithmetic. It never converts itself to a
 * JavaScript `number`. It is not a `HugeNumber`: a stage is a discrete counter
 * with successor and divisibility semantics, not an approximate magnitude.
 *
 * Serialises to its canonical decimal string (`toString`, `toJSON`), the same
 * form `parse` accepts and the API sends.
 */
export class StageNumber {
  /** The first stage. Every character starts here. */
  public static readonly FIRST = new StageNumber(1n);

  private constructor(private readonly value: bigint) {}

  /**
   * From an integer value. A `number` must be a safe integer, so no value that
   * has already lost precision can become a stage.
   *
   * @throws {GameCoreError} `NOT_A_SAFE_INTEGER` or `OUT_OF_RANGE`.
   */
  public static of(value: bigint | number): StageNumber {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new GameCoreError('NOT_A_SAFE_INTEGER', 'Stage number must be a safe integer.');
    }
    const integer = BigInt(value);
    if (integer < 1n || integer > STAGE_NUMBER_MAX) {
      throw outOfRange();
    }
    return integer === 1n ? StageNumber.FIRST : new StageNumber(integer);
  }

  /**
   * From the canonical decimal string only — `"1"`, `"42"`, never `"042"`,
   * `"+1"`, `"1e3"` or `"1.0"`. Input length is bounded before any conversion.
   *
   * @throws {GameCoreError} `INVALID_FORMAT` or `OUT_OF_RANGE`.
   */
  public static parse(text: string): StageNumber {
    if (!CANONICAL_PATTERN.test(text)) {
      throw new GameCoreError(
        'INVALID_FORMAT',
        'Stage number must be a canonical decimal integer (no sign, no leading zeros).',
      );
    }
    return StageNumber.of(BigInt(text));
  }

  public toBigInt(): bigint {
    return this.value;
  }

  /** Canonical decimal form. */
  public toString(): string {
    return this.value.toString();
  }

  /** JSON carries the canonical string: a JSON number cannot hold every stage. */
  public toJSON(): string {
    return this.toString();
  }

  /** Exact total order: `-1`, `0` or `1`. */
  public compare(other: StageNumber): -1 | 0 | 1 {
    if (this.value === other.value) {
      return 0;
    }
    return this.value < other.value ? -1 : 1;
  }

  public equals(other: StageNumber): boolean {
    return this.value === other.value;
  }

  /**
   * The stage `offset` stages further on.
   *
   * @throws {GameCoreError} `INVALID_ARGUMENT` for a negative or non-integer
   *   offset, `OUT_OF_RANGE` past {@link STAGE_NUMBER_MAX}.
   */
  public plus(offset: number): StageNumber {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new GameCoreError('INVALID_ARGUMENT', 'Stage offset must be a non-negative integer.');
    }
    return offset === 0 ? this : StageNumber.of(this.value + BigInt(offset));
  }

  /** The following stage. */
  public next(): StageNumber {
    return this.plus(1);
  }

  /** Stages before this one (`stage − 1`): the exponent of per-stage scaling. */
  public stagesBefore(): bigint {
    return this.value - 1n;
  }

  /**
   * Whether this stage is a multiple of `interval` — boss stages, for example.
   *
   * @throws {GameCoreError} `INVALID_ARGUMENT` unless `interval` is a positive
   *   safe integer.
   */
  public isMultipleOf(interval: number): boolean {
    if (!Number.isSafeInteger(interval) || interval < 1) {
      throw new GameCoreError('INVALID_ARGUMENT', 'Interval must be a positive safe integer.');
    }
    return this.value % BigInt(interval) === 0n;
  }
}
