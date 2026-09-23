import { describe, expect, it } from 'vitest';
import { STAGE_NUMBER_WIRE_MAX, stageNumberSchema } from './stage-number.contract.js';

describe('stageNumberSchema', () => {
  it.each(['1', '10', '9007199254740993', STAGE_NUMBER_WIRE_MAX])('accepts %s', (value) => {
    expect(stageNumberSchema.parse(value)).toBe(value);
  });

  it('is the PostgreSQL bigint maximum', () => {
    expect(BigInt(STAGE_NUMBER_WIRE_MAX)).toBe(2n ** 63n - 1n);
  });

  it.each([
    '',
    '0',
    '01',
    '+1',
    '-1',
    ' 1',
    '1.0',
    '1e3',
    '1,000',
    '9223372036854775808',
    '9999999999999999999',
    '1'.repeat(20),
  ])('rejects %j', (value) => {
    expect(stageNumberSchema.safeParse(value).success).toBe(false);
  });

  it.each([1, 1n, null])('rejects the non-string %s', (value) => {
    expect(stageNumberSchema.safeParse(value).success).toBe(false);
  });
});
