import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import {
  HUGE_NUMBER_MAX_EXPONENT,
  HUGE_NUMBER_MIN_EXPONENT,
  HUGE_NUMBER_ZERO_EXPONENT,
  HugeNumber,
} from './huge-number.js';

const h = (text: string): HugeNumber => HugeNumber.parse(text);

function expectCode(action: () => unknown, code: GameCoreErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GameCoreError);
    expect((error as GameCoreError).code).toBe(code);
    return;
  }
  expect.fail(`expected GameCoreError ${code}`);
}

describe('HugeNumber — canonical parsing', () => {
  it.each([
    '0',
    '1e0',
    '-1e0',
    '1.5e3',
    '2.5e-1',
    '9.99999999999999999e17',
    '1.23456789012345679e20',
    `1e${HUGE_NUMBER_MAX_EXPONENT}`,
    `-9.99999999999999999e${HUGE_NUMBER_MAX_EXPONENT}`,
    `1e${HUGE_NUMBER_MIN_EXPONENT}`,
  ])('round-trips %s exactly', (text) => {
    expect(h(text).toString()).toBe(text);
  });

  it.each([
    ['empty', ''],
    ['negative zero', '-0'],
    ['plain integer', '1500'],
    ['plus sign', '+1e0'],
    ['plus sign in exponent', '1e+3'],
    ['upper-case E', '1E3'],
    ['leading zero digit', '0.5e0'],
    ['non-normalised mantissa', '15e2'],
    ['trailing zero in fraction', '1.50e3'],
    ['empty fraction', '1.e3'],
    ['nineteen digits', '1.234567890123456789e0'],
    ['leading zero in exponent', '1e03'],
    ['negative zero exponent', '1e-0'],
    ['whitespace', ' 1e0'],
    ['zero with exponent', '0e0'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['hex', '0x10'],
  ])('rejects %s', (_name, text) => {
    expectCode(() => HugeNumber.parse(text), 'INVALID_FORMAT');
    expect(HugeNumber.isCanonical(text)).toBe(false);
  });

  it('rejects exponents outside the signed 32-bit range', () => {
    expectCode(() => h(`1e${HUGE_NUMBER_MAX_EXPONENT + 1}`), 'OUT_OF_RANGE');
    expectCode(() => h(`1e${HUGE_NUMBER_ZERO_EXPONENT}`), 'OUT_OF_RANGE');
    expectCode(() => h('1e99999999999999999999999'), 'OUT_OF_RANGE');
    expect(HugeNumber.isCanonical(`1e${HUGE_NUMBER_MAX_EXPONENT + 1}`)).toBe(false);
  });

  it('accepts every canonical value', () => {
    expect(HugeNumber.isCanonical('1.5e3')).toBe(true);
    expect(HugeNumber.isCanonical('0')).toBe(true);
  });
});

describe('HugeNumber — lenient decimal input', () => {
  it('parses content-style decimals exactly', () => {
    expect(HugeNumber.fromDecimal('1.07').toString()).toBe('1.07e0');
    expect(HugeNumber.fromDecimal('1500').toString()).toBe('1.5e3');
    expect(HugeNumber.fromDecimal('-2.5E-3').toString()).toBe('-2.5e-3');
  });

  it.each(['', '.', '-', 'e5', '1e', '1.2.3', '1,5', ' 1', 'abc', '1e5.5', '--1'])(
    'rejects %j',
    (text) => {
      expectCode(() => HugeNumber.fromDecimal(text), 'INVALID_FORMAT');
    },
  );

  it('bounds the work an oversized input can cause', () => {
    expectCode(() => HugeNumber.fromDecimal('1'.repeat(513)), 'INVALID_FORMAT');
    expectCode(() => HugeNumber.fromDecimal('1e1234567890123456'), 'OUT_OF_RANGE');
  });
});

describe('HugeNumber — construction from integers', () => {
  it('accepts safe integers exactly', () => {
    expect(HugeNumber.fromNumber(0).toString()).toBe('0');
    expect(HugeNumber.fromNumber(-0).toString()).toBe('0');
    expect(HugeNumber.fromNumber(1234567).toString()).toBe('1.234567e6');
    expect(HugeNumber.fromNumber(Number.MAX_SAFE_INTEGER).toString()).toBe('9.007199254740991e15');
    expect(HugeNumber.fromNumber(-42).toString()).toBe('-4.2e1');
  });

  it.each([0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuses %s so a float never becomes authoritative',
    (value) => {
      expectCode(() => HugeNumber.fromNumber(value), 'NOT_A_SAFE_INTEGER');
    },
  );

  it('keeps every integer below 10^18 exact', () => {
    expect(HugeNumber.fromBigInt(999_999_999_999_999_999n).toString()).toBe(
      '9.99999999999999999e17',
    );
    const sum = HugeNumber.fromNumber(1_234_567).add(HugeNumber.ONE);
    expect(sum.eq(HugeNumber.fromNumber(1_234_568))).toBe(true);
  });

  it('rounds wider integers half-to-even', () => {
    expect(HugeNumber.fromBigInt(1_000_000_000_000_000_005n).toString()).toBe('1e18');
    expect(HugeNumber.fromBigInt(1_000_000_000_000_000_015n).toString()).toBe(
      '1.00000000000000002e18',
    );
  });
});

describe('HugeNumber — normalisation and parts', () => {
  it('exposes the two-column persistence form', () => {
    expect(h('1.5e3').toParts()).toEqual({ coefficient: 150_000_000_000_000_000n, exponent: 3 });
    expect(HugeNumber.ZERO.toParts()).toEqual({
      coefficient: 0n,
      exponent: HUGE_NUMBER_ZERO_EXPONENT,
    });
  });

  it('rebuilds a value from normalised parts', () => {
    const value = h('-1.23456789012345678e-40');
    const { coefficient, exponent } = value.toParts();
    expect(HugeNumber.fromParts(coefficient, exponent).eq(value)).toBe(true);
    expect(HugeNumber.fromParts(0n, HUGE_NUMBER_ZERO_EXPONENT).isZero()).toBe(true);
  });

  it('rejects non-normalised or out-of-range parts instead of repairing them', () => {
    expectCode(() => HugeNumber.fromParts(15n, 3), 'INVALID_ARGUMENT');
    expectCode(() => HugeNumber.fromParts(10n ** 18n, 3), 'INVALID_ARGUMENT');
    expectCode(() => HugeNumber.fromParts(0n, 0), 'INVALID_ARGUMENT');
    expectCode(() => HugeNumber.fromParts(10n ** 17n, HUGE_NUMBER_ZERO_EXPONENT), 'OUT_OF_RANGE');
    expectCode(() => HugeNumber.fromParts(10n ** 17n, 1.5), 'OUT_OF_RANGE');
  });

  it('gives equal values identical representations', () => {
    const a = HugeNumber.fromDecimal('1500.000');
    const b = HugeNumber.fromNumber(1500);
    const c = h('1.5e3');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.toString()).toBe(c.toString());
  });
});

describe('HugeNumber — zero', () => {
  it('has a single representation and no negative zero', () => {
    expect(HugeNumber.ZERO.neg().toString()).toBe('0');
    expect(h('1e0').sub(h('1e0'))).toEqual(HugeNumber.ZERO);
    expect(h('-1e0').mul(HugeNumber.ZERO)).toEqual(HugeNumber.ZERO);
    expect(HugeNumber.ZERO.div(h('-3e0'))).toEqual(HugeNumber.ZERO);
    expect(HugeNumber.ZERO.sign()).toBe(0);
    expect(HugeNumber.ZERO.isNegative()).toBe(false);
  });

  it('is the identity for addition and absorbing for multiplication', () => {
    const value = h('7.5e12');
    expect(value.add(HugeNumber.ZERO)).toBe(value);
    expect(HugeNumber.ZERO.add(value)).toBe(value);
    expect(value.mul(HugeNumber.ZERO).isZero()).toBe(true);
  });

  it('sorts below every positive value and above every negative value', () => {
    expect(HugeNumber.ZERO.compare(h(`1e${HUGE_NUMBER_MIN_EXPONENT}`))).toBe(-1);
    expect(HugeNumber.ZERO.compare(h(`-1e${HUGE_NUMBER_MIN_EXPONENT}`))).toBe(1);
  });
});

describe('HugeNumber — comparison', () => {
  const ascending = [
    `-9.99999999999999999e${HUGE_NUMBER_MAX_EXPONENT}`,
    '-1e20',
    '-9.99999999999999999e19',
    '-2e0',
    '-1.00000000000000001e0',
    '-1e0',
    `-1e${HUGE_NUMBER_MIN_EXPONENT}`,
    '0',
    `1e${HUGE_NUMBER_MIN_EXPONENT}`,
    '1e-1',
    '9.99999999999999999e-1',
    '1e0',
    '1.00000000000000001e0',
    '2e0',
    '9.99999999999999999e19',
    '1e20',
    `9.99999999999999999e${HUGE_NUMBER_MAX_EXPONENT}`,
  ].map(h);

  it('is a strict total order consistent with numeric order', () => {
    ascending.forEach((left, i) => {
      ascending.forEach((right, j) => {
        const expected = Math.sign(i - j);
        expect(left.compare(right)).toBe(expected);
        expect(left.lt(right)).toBe(i < j);
        expect(left.lte(right)).toBe(i <= j);
        expect(left.gt(right)).toBe(i > j);
        expect(left.gte(right)).toBe(i >= j);
        expect(left.eq(right)).toBe(i === j);
      });
    });
  });

  it('selects min and max', () => {
    const [low, high] = [h('-5e0'), h('3e2')];
    expect(HugeNumber.min(low, high)).toBe(low);
    expect(HugeNumber.max(low, high)).toBe(high);
  });
});

describe('HugeNumber — arithmetic edge cases', () => {
  it('computes exact small-integer arithmetic without float drift', () => {
    expect(HugeNumber.fromDecimal('0.1').add(HugeNumber.fromDecimal('0.2')).toString()).toBe(
      '3e-1',
    );
    expect(h('1.2e1').mul(h('1.2e1')).toString()).toBe('1.44e2');
  });

  it('refuses division by zero instead of producing Infinity', () => {
    expectCode(() => h('1e0').div(HugeNumber.ZERO), 'DIVISION_BY_ZERO');
    expectCode(() => HugeNumber.ZERO.div(HugeNumber.ZERO), 'DIVISION_BY_ZERO');
  });

  it('overflows deterministically and underflows to zero', () => {
    const max = h(`9.99999999999999999e${HUGE_NUMBER_MAX_EXPONENT}`);
    expectCode(() => max.add(max), 'OVERFLOW');
    expectCode(() => max.mul(h('1e1')), 'OVERFLOW');
    expectCode(() => max.neg().mul(h('1e1')), 'OVERFLOW');
    const tiny = h(`1e${HUGE_NUMBER_MIN_EXPONENT}`);
    expect(tiny.div(h('1e1')).isZero()).toBe(true);
    expect(tiny.mul(tiny).isZero()).toBe(true);
  });

  it('rejects invalid powers', () => {
    expectCode(() => h('2e0').pow(-1), 'INVALID_ARGUMENT');
    expectCode(() => h('2e0').pow(1.5), 'INVALID_ARGUMENT');
    expectCode(() => h('2e0').pow(2 ** 53), 'INVALID_ARGUMENT');
    expectCode(() => h('2e0').pow(-1n), 'INVALID_ARGUMENT');
  });

  it('takes bigint powers exactly like number powers, and beyond the safe range', () => {
    const growth = h('1.12e0');
    for (const power of [0, 1, 2, 3, 100, 12_345]) {
      expect(growth.pow(BigInt(power))).toEqual(growth.pow(power));
    }
    expect(
      h('1e0')
        .pow(2n ** 63n)
        .toString(),
    ).toBe('1e0');
    expectCode(() => h('2e0').pow(2n ** 63n), 'OVERFLOW');
  });

  it('negates and takes absolute values', () => {
    expect(h('3e0').neg().toString()).toBe('-3e0');
    expect(h('-3e0').abs().toString()).toBe('3e0');
    expect(h('3e0').abs().toString()).toBe('3e0');
  });

  it('recognises integers', () => {
    expect(h('1.5e3').isInteger()).toBe(true);
    expect(h('1.5e0').isInteger()).toBe(false);
    expect(h('1.23456789012345678e17').isInteger()).toBe(true);
    expect(h('1.23456789012345678e16').isInteger()).toBe(false);
    expect(h('5e-1').isInteger()).toBe(false);
    expect(HugeNumber.ZERO.isInteger()).toBe(true);
  });
});

describe('HugeNumber — domain validation', () => {
  it('passes non-negative values through', () => {
    const value = h('1.5e3');
    expect(value.ensureNonNegative('damage')).toBe(value);
    expect(HugeNumber.ZERO.ensureNonNegative('damage')).toBe(HugeNumber.ZERO);
  });

  it('rejects negative values and names the field', () => {
    expectCode(() => h('-1e0').ensureNonNegative('gold'), 'NEGATIVE_VALUE');
    expect(() => h('-1e0').ensureNonNegative('gold')).toThrow('gold must not be negative.');
  });
});

describe('HugeNumber — serialisation', () => {
  it('serialises to JSON as the canonical string, never as a number', () => {
    const payload = { gold: h('1.23456789012345678e40'), zero: HugeNumber.ZERO };
    expect(JSON.stringify(payload)).toBe('{"gold":"1.23456789012345678e40","zero":"0"}');
  });
});
