import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GameCoreError,
  HUGE_NUMBER_MAX_EXPONENT,
  HUGE_NUMBER_MIN_EXPONENT,
  HugeNumber,
} from '../src/index.js';

/**
 * Property tests for HugeNumber (ADR-013, section 6).
 *
 * Arithmetic is checked against a deliberately different reference: exact
 * integer arithmetic on the full operands, then half-to-even rounding done on
 * the decimal digit string. The implementation instead rounds with bigint
 * division and takes a shortcut for widely separated addends, so agreement is
 * meaningful.
 */

const PRECISION = 18;
const NUM_RUNS = 2_000;

// -----------------------------------------------------------------------------
// Reference implementation
// -----------------------------------------------------------------------------

type Reference = string; // canonical string, or 'OVERFLOW'

/** Rounds the exact value `significand × 10^scale` to a canonical string. */
function referenceRound(significand: bigint, scale: number): Reference {
  if (significand === 0n) {
    return '0';
  }
  const sign = significand < 0n ? '-' : '';
  const digits = (significand < 0n ? -significand : significand).toString();
  let kept: string;
  let unitScale: number;
  if (digits.length > PRECISION) {
    kept = digits.slice(0, PRECISION);
    const dropped = digits.slice(PRECISION);
    unitScale = scale + dropped.length;
    const firstDropped = dropped.charAt(0);
    const aboveHalf =
      firstDropped > '5' || (firstDropped === '5' && /[1-9]/u.test(dropped.slice(1)));
    const isTie = firstDropped === '5' && !/[1-9]/u.test(dropped.slice(1));
    const lastKeptIsOdd = Number(kept.charAt(PRECISION - 1)) % 2 === 1;
    if (aboveHalf || (isTie && lastKeptIsOdd)) {
      kept = (BigInt(kept) + 1n).toString();
      if (kept.length > PRECISION) {
        kept = kept.slice(0, PRECISION);
        unitScale += 1;
      }
    }
  } else {
    unitScale = scale - (PRECISION - digits.length);
    kept = digits.padEnd(PRECISION, '0');
  }
  const exponent = unitScale + PRECISION - 1;
  if (exponent > HUGE_NUMBER_MAX_EXPONENT) {
    return 'OVERFLOW';
  }
  if (exponent < HUGE_NUMBER_MIN_EXPONENT) {
    return '0';
  }
  const fraction = kept.slice(1).replace(/0+$/u, '');
  return `${sign}${kept.charAt(0)}${fraction === '' ? '' : `.${fraction}`}e${exponent}`;
}

function exact(value: HugeNumber): { significand: bigint; scale: number } {
  const { coefficient, exponent } = value.toParts();
  // Zero's exponent is a storage sentinel, not a magnitude.
  return { significand: coefficient, scale: value.isZero() ? 0 : exponent - (PRECISION - 1) };
}

function referenceAdd(a: HugeNumber, b: HugeNumber): Reference {
  if (a.isZero() || b.isZero()) {
    return (a.isZero() ? b : a).toString();
  }
  const [x, rawY] = a.abs().gte(b.abs()) ? [exact(a), exact(b)] : [exact(b), exact(a)];
  // An addend more than 60 digits below the other cannot be materialised when
  // exponents are ~2^31 apart. Replace it with a sticky unit of the same sign,
  // still far below the rounding position: the correctly rounded sum is the
  // same, and this is a different mechanism from the implementation's shortcut.
  const y =
    x.scale - rawY.scale > 60
      ? { significand: rawY.significand < 0n ? -1n : 1n, scale: x.scale - 60 }
      : rawY;
  const scale = Math.min(x.scale, y.scale);
  const sum =
    x.significand * 10n ** BigInt(x.scale - scale) + y.significand * 10n ** BigInt(y.scale - scale);
  return referenceRound(sum, scale);
}

function referenceMul(a: HugeNumber, b: HugeNumber): Reference {
  const x = exact(a);
  const y = exact(b);
  return referenceRound(x.significand * y.significand, x.scale + y.scale);
}

function referenceDiv(a: HugeNumber, b: HugeNumber): Reference {
  const x = exact(a);
  const y = exact(b);
  const extra = 40;
  const numerator = (x.significand < 0n ? -x.significand : x.significand) * 10n ** BigInt(extra);
  const denominator = y.significand < 0n ? -y.significand : y.significand;
  const quotient = numerator / denominator;
  // A trailing sticky digit records an inexact remainder without affecting
  // any digit that could be kept.
  const sticky = numerator % denominator === 0n ? 0n : 1n;
  const magnitude = quotient * 10n + sticky;
  const negative = x.significand < 0n !== y.significand < 0n;
  return referenceRound(negative ? -magnitude : magnitude, x.scale - y.scale - extra - 1);
}

function actual(operation: () => HugeNumber): Reference {
  try {
    return operation().toString();
  } catch (error) {
    if (error instanceof GameCoreError && error.code === 'OVERFLOW') {
      return 'OVERFLOW';
    }
    throw error;
  }
}

/** Exact comparison of two values with moderate exponents. */
function referenceCompare(a: HugeNumber, b: HugeNumber): number {
  const x = exact(a);
  const y = exact(b);
  const scale = Math.min(x.scale, y.scale);
  const left = x.significand * 10n ** BigInt(x.scale - scale);
  const right = y.significand * 10n ** BigInt(y.scale - scale);
  return left === right ? 0 : left < right ? -1 : 1;
}

// -----------------------------------------------------------------------------
// Arbitraries
// -----------------------------------------------------------------------------

const coefficient = fc.oneof(
  fc.bigInt({ min: 10n ** 17n, max: 10n ** 18n - 1n }),
  // Round coefficients make carries, ties and exact results likely.
  fc.integer({ min: 1, max: 9 }).map((digit) => BigInt(digit) * 10n ** 17n),
  fc.constantFrom(10n ** 17n, 10n ** 18n - 1n, 5n * 10n ** 17n, 15n * 10n ** 16n),
);

function hugeNumber(minExponent: number, maxExponent: number): fc.Arbitrary<HugeNumber> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant(HugeNumber.ZERO) },
    {
      weight: 12,
      arbitrary: fc
        .tuple(fc.boolean(), coefficient, fc.integer({ min: minExponent, max: maxExponent }))
        .map(([negative, c, e]) => HugeNumber.fromParts(negative ? -c : c, e)),
    },
    {
      weight: 3,
      arbitrary: fc
        .integer({ min: -1_000_000, max: 1_000_000 })
        .map((value) => HugeNumber.fromNumber(value)),
    },
  );
}

/** Operands close enough in magnitude for their digits to interact. */
const moderate = hugeNumber(-40, 40);
/** Operands spanning the whole exponent range, including both extremes. */
const anyRange = fc.oneof(
  hugeNumber(HUGE_NUMBER_MIN_EXPONENT, HUGE_NUMBER_MAX_EXPONENT),
  hugeNumber(HUGE_NUMBER_MAX_EXPONENT - 40, HUGE_NUMBER_MAX_EXPONENT),
  hugeNumber(HUGE_NUMBER_MIN_EXPONENT, HUGE_NUMBER_MIN_EXPONENT + 40),
);
const nonZeroModerate = moderate.filter((value) => !value.isZero());

const property = (predicate: fc.IProperty<[HugeNumber, HugeNumber]>): void => {
  fc.assert(predicate, { numRuns: NUM_RUNS });
};

// -----------------------------------------------------------------------------
// Properties
// -----------------------------------------------------------------------------

describe('HugeNumber properties — canonical serialisation', () => {
  it('parse(toString(x)) is x, and the string is canonical', () => {
    fc.assert(
      fc.property(anyRange, (value) => {
        const text = value.toString();
        expect(HugeNumber.isCanonical(text)).toBe(true);
        expect(HugeNumber.parse(text).eq(value)).toBe(true);
        expect(HugeNumber.parse(text).toString()).toBe(text);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fromParts(toParts(x)) and fromDecimal(toString(x)) are x', () => {
    fc.assert(
      fc.property(anyRange, (value) => {
        const { coefficient: c, exponent: e } = value.toParts();
        expect(HugeNumber.fromParts(c, e).eq(value)).toBe(true);
        expect(HugeNumber.fromDecimal(value.toString()).eq(value)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('agrees with the reference when rounding arbitrary-length integers', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }), (value) => {
        expect(HugeNumber.fromBigInt(value).toString()).toBe(referenceRound(value, 0));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('HugeNumber properties — arithmetic agrees with the exact reference', () => {
  it.each([
    ['moderate exponents', moderate],
    ['the full exponent range', anyRange],
  ])('add and sub over %s', (_name, arbitrary) => {
    property(
      fc.property(arbitrary, arbitrary, (a, b) => {
        expect(actual(() => a.add(b))).toBe(referenceAdd(a, b));
        expect(actual(() => a.sub(b))).toBe(referenceAdd(a, b.neg()));
      }),
    );
  });

  it('add across every gap around the exact-addition window', () => {
    fc.assert(
      fc.property(
        coefficient,
        coefficient,
        fc.integer({ min: 0, max: 45 }),
        fc.boolean(),
        (ca, cb, gap, negative) => {
          const a = HugeNumber.fromParts(ca, 10);
          const b = HugeNumber.fromParts(negative ? -cb : cb, 10 - gap);
          expect(actual(() => a.add(b))).toBe(referenceAdd(a, b));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it.each([
    ['moderate exponents', moderate],
    ['the full exponent range', anyRange],
  ])('mul over %s', (_name, arbitrary) => {
    property(
      fc.property(arbitrary, arbitrary, (a, b) => {
        expect(actual(() => a.mul(b))).toBe(referenceMul(a, b));
      }),
    );
  });

  it('div over moderate and extreme exponents', () => {
    const divisor = fc.oneof(
      nonZeroModerate,
      anyRange.filter((value) => !value.isZero()),
    );
    property(
      fc.property(fc.oneof(moderate, anyRange), divisor, (a, b) => {
        expect(actual(() => a.div(b))).toBe(referenceDiv(a, b));
      }),
    );
  });
});

describe('HugeNumber properties — algebra that survives rounding', () => {
  it('addition and multiplication are commutative', () => {
    property(
      fc.property(anyRange, anyRange, (a, b) => {
        expect(actual(() => a.add(b))).toBe(actual(() => b.add(a)));
        expect(actual(() => a.mul(b))).toBe(actual(() => b.mul(a)));
      }),
    );
  });

  it('has exact identities and inverses', () => {
    fc.assert(
      fc.property(anyRange, (a) => {
        expect(a.add(HugeNumber.ZERO).eq(a)).toBe(true);
        expect(a.sub(a).isZero()).toBe(true);
        expect(a.mul(HugeNumber.ONE).eq(a)).toBe(true);
        expect(a.neg().neg().eq(a)).toBe(true);
        if (!a.isZero()) {
          expect(a.div(HugeNumber.ONE).eq(a)).toBe(true);
          expect(a.div(a).eq(HugeNumber.ONE)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('addition is monotonic', () => {
    fc.assert(
      fc.property(moderate, moderate, moderate, (a, b, c) => {
        const [low, high] = a.lte(b) ? [a, b] : [b, a];
        expect(low.add(c).lte(high.add(c))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('floor is the largest integer not above the value', () => {
    fc.assert(
      fc.property(moderate, (a) => {
        const floor = a.floor();
        expect(floor.isInteger()).toBe(true);
        expect(floor.lte(a)).toBe(true);
        if (a.abs().lt(HugeNumber.fromBigInt(10n ** 17n))) {
          // floor + 1 is exact only below 10^17.
          expect(floor.add(HugeNumber.ONE).gt(a)).toBe(true);
        } else {
          // At 18 significant digits, every value from 10^17 up is an integer.
          expect(floor.eq(a)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('HugeNumber properties — ordering', () => {
  it('compare matches exact numeric order', () => {
    property(
      fc.property(moderate, moderate, (a, b) => {
        expect(a.compare(b)).toBe(referenceCompare(a, b));
      }),
    );
  });

  it('compare is antisymmetric and consistent with eq', () => {
    property(
      fc.property(anyRange, anyRange, (a, b) => {
        expect(a.compare(b)).toBe(-b.compare(a) || 0);
        expect(a.compare(b) === 0).toBe(a.eq(b));
      }),
    );
  });

  it('for non-negative values, compare equals (exponent, coefficient) order — the SQL ORDER BY', () => {
    const nonNegative = anyRange.map((value) => value.abs());
    property(
      fc.property(nonNegative, nonNegative, (a, b) => {
        const x = a.toParts();
        const y = b.toParts();
        const lexicographic =
          x.exponent !== y.exponent
            ? Math.sign(x.exponent - y.exponent)
            : x.coefficient === y.coefficient
              ? 0
              : x.coefficient < y.coefficient
                ? -1
                : 1;
        expect(a.compare(b)).toBe(lexicographic);
      }),
    );
  });

  it('sign of a - b equals compare(a, b) where no underflow is possible', () => {
    property(
      fc.property(moderate, moderate, (a, b) => {
        expect(a.sub(b).sign()).toBe(a.compare(b));
      }),
    );
  });
});
