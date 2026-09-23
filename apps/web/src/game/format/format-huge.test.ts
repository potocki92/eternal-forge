import { describe, expect, it } from 'vitest';
import { formatHuge, hugeRatio } from './format-huge';

describe('formatHuge', () => {
  it.each([
    ['0', '0'],
    ['5e0', '5'],
    ['1.21e2', '121'],
    ['1.21e1', '12.1'],
    ['1.331e1', '13.3'],
    ['1.24e3', '1,240'],
    ['9.999e3', '9,999'],
    ['1.24e4', '12.4K'],
    ['1.24567e5', '124K'],
    ['5.28e6', '5.28M'],
    ['5e6', '5M'],
    ['8.319e9', '8.31B'],
    ['1e12', '1T'],
    ['9.99999e14', '999T'],
    ['1.23456e15', '1.23e15'],
    ['6.66034073944804727e22', '6.66e22'],
    ['1e2147483647', '1e2147483647'],
  ])('%s → %s', (value, expected) => {
    expect(formatHuge(value)).toBe(expected);
  });

  it('truncates instead of rounding up, so a balance is never overstated', () => {
    expect(formatHuge('9.9999e5')).toBe('999K');
  });

  it('rejects a non-canonical string instead of guessing', () => {
    expect(() => formatHuge('1500')).toThrow();
  });
});

describe('hugeRatio', () => {
  it.each([
    ['0', '1e2', 0],
    ['5e1', '1e2', 0.5],
    ['1e2', '1e2', 1],
    ['2e2', '1e2', 1],
    ['1e0', '1e40', 0],
    ['2.5e39', '1e40', 0.25],
    ['5e1', '0', 0],
  ])('%s / %s = %d', (value, max, expected) => {
    expect(hugeRatio(value, max)).toBeCloseTo(expected, 10);
  });
});
