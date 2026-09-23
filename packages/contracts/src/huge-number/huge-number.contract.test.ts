import { HugeNumber } from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import { hugeAmountSchema, hugeNumberSchema } from './huge-number.contract.js';

describe('hugeNumberSchema', () => {
  it.each(['0', '5e0', '1.5e3', '-2.5e-1', '1.23456789012345679e20', '9e2147483647'])(
    'accepts the canonical %s',
    (value) => {
      expect(hugeNumberSchema.parse(value)).toBe(value);
    },
  );

  it.each(['', '5', '1500', '1.50e3', '+5e0', '5E0', '0e0', 'NaN', 'Infinity', '1e2147483648'])(
    'rejects the non-canonical %j',
    (value) => {
      expect(hugeNumberSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([5, 5n, null])('rejects the non-string %s', (value) => {
    expect(hugeNumberSchema.safeParse(value).success).toBe(false);
  });

  it('agrees with Game Core: the API’s own output always satisfies the contract', () => {
    for (const text of ['0', '7', '1234567890123456789012', '0.001', '-42']) {
      const value = HugeNumber.fromDecimal(text).toString();
      expect(hugeNumberSchema.parse(value)).toBe(value);
    }
  });
});

describe('hugeAmountSchema', () => {
  it('accepts zero and positive amounts', () => {
    expect(hugeAmountSchema.parse('0')).toBe('0');
    expect(hugeAmountSchema.parse('3.6e1')).toBe('3.6e1');
  });

  it('rejects negative amounts', () => {
    expect(hugeAmountSchema.safeParse('-1e0').success).toBe(false);
  });
});
