import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import { STAGE_NUMBER_MAX, StageNumber } from './stage-number.js';

function expectCode(action: () => unknown, code: GameCoreErrorCode): void {
  expect(action).toThrow(GameCoreError);
  expect(action).toThrow(expect.objectContaining({ code }));
}

const validStage = fc.bigInt({ min: 1n, max: STAGE_NUMBER_MAX });

describe('StageNumber — construction', () => {
  it('accepts 1 through the PostgreSQL bigint maximum', () => {
    expect(StageNumber.of(1).toBigInt()).toBe(1n);
    expect(StageNumber.of(1n)).toBe(StageNumber.FIRST);
    expect(StageNumber.of(STAGE_NUMBER_MAX).toBigInt()).toBe(2n ** 63n - 1n);
  });

  it.each([0, -1, 0n, -1n, STAGE_NUMBER_MAX + 1n])('rejects %s as out of range', (value) => {
    expectCode(() => StageNumber.of(value), 'OUT_OF_RANGE');
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects the number %s, which is not a safe integer',
    (value) => {
      expectCode(() => StageNumber.of(value), 'NOT_A_SAFE_INTEGER');
    },
  );

  it('keeps precision beyond 2^53, where a JavaScript number cannot', () => {
    const stage = StageNumber.of(2n ** 53n + 1n);
    expect(stage.toString()).toBe('9007199254740993');
    expect(stage.equals(StageNumber.of(2n ** 53n))).toBe(false);
  });
});

describe('StageNumber — canonical decimal form', () => {
  it.each(['1', '10', '9007199254740993', '9223372036854775807'])('round-trips %s', (text) => {
    expect(StageNumber.parse(text).toString()).toBe(text);
  });

  it.each([
    '',
    '0',
    '01',
    '+1',
    '-1',
    ' 1',
    '1 ',
    '1.0',
    '1e3',
    '0x10',
    '1_000',
    '1,000',
    '١',
    '9'.repeat(20),
  ])('rejects %j as not canonical', (text) => {
    expectCode(() => StageNumber.parse(text), 'INVALID_FORMAT');
  });

  it('rejects a canonical 19-digit value above the maximum as out of range', () => {
    expectCode(() => StageNumber.parse('9223372036854775808'), 'OUT_OF_RANGE');
  });

  it('serialises to JSON as the canonical string, never as a number', () => {
    expect(JSON.stringify({ stage: StageNumber.of(STAGE_NUMBER_MAX) })).toBe(
      '{"stage":"9223372036854775807"}',
    );
  });

  it('parse ∘ toString is the identity across the whole range', () => {
    fc.assert(
      fc.property(validStage, (value) => {
        const stage = StageNumber.of(value);
        expect(StageNumber.parse(stage.toString()).toBigInt()).toBe(value);
        expect(stage.toString()).toBe(value.toString());
      }),
    );
  });
});

describe('StageNumber — arithmetic and order', () => {
  it('orders exactly like the underlying integers', () => {
    fc.assert(
      fc.property(validStage, validStage, (a, b) => {
        const expected = a === b ? 0 : a < b ? -1 : 1;
        expect(StageNumber.of(a).compare(StageNumber.of(b))).toBe(expected);
        expect(StageNumber.of(a).equals(StageNumber.of(b))).toBe(a === b);
      }),
    );
  });

  it('steps forward exactly and refuses to pass the maximum', () => {
    expect(
      StageNumber.of(2n ** 53n)
        .next()
        .toString(),
    ).toBe('9007199254740993');
    expect(StageNumber.of(7).plus(0).toString()).toBe('7');
    expect(StageNumber.of(7).plus(3).toString()).toBe('10');
    expectCode(() => StageNumber.of(STAGE_NUMBER_MAX).next(), 'OUT_OF_RANGE');
  });

  it.each([-1, 1.5, Number.NaN])('rejects the offset %s', (offset) => {
    expectCode(() => StageNumber.FIRST.plus(offset), 'INVALID_ARGUMENT');
    expectCode(() => StageNumber.FIRST.stepBack(offset), 'INVALID_ARGUMENT');
  });

  it('steps back exactly and saturates at the first stage', () => {
    expect(StageNumber.of(10).stepBack(1).toString()).toBe('9');
    expect(StageNumber.of(10).stepBack(0).toString()).toBe('10');
    expect(StageNumber.of(3).stepBack(2)).toBe(StageNumber.FIRST);
    expect(StageNumber.of(3).stepBack(1_000)).toBe(StageNumber.FIRST);
    expect(StageNumber.FIRST.stepBack(1)).toBe(StageNumber.FIRST);
    expect(StageNumber.of(STAGE_NUMBER_MAX).stepBack(1).toString()).toBe('9223372036854775806');
    expect(
      StageNumber.of(2n ** 53n + 1n)
        .stepBack(1)
        .toString(),
    ).toBe('9007199254740992');
  });

  it('stepping back undoes stepping forward away from the first stage', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: STAGE_NUMBER_MAX - 1_000n }),
        fc.integer({ min: 0, max: 1_000 }),
        (value, offset) => {
          const stage = StageNumber.of(value);
          expect(stage.plus(offset).stepBack(offset).equals(stage)).toBe(true);
        },
      ),
    );
  });

  it('counts the stages before it', () => {
    expect(StageNumber.FIRST.stagesBefore()).toBe(0n);
    expect(StageNumber.of(STAGE_NUMBER_MAX).stagesBefore()).toBe(STAGE_NUMBER_MAX - 1n);
  });

  it('tests divisibility exactly, including beyond 2^53', () => {
    expect(StageNumber.of(10).isMultipleOf(10)).toBe(true);
    expect(StageNumber.of(11).isMultipleOf(10)).toBe(false);
    // 2^53 + 1 is odd, but as a double it rounds to 2^53, which is even.
    expect(StageNumber.of(2n ** 53n + 1n).isMultipleOf(2)).toBe(false);
  });

  it.each([0, -10, 2.5])('rejects the interval %s', (interval) => {
    expectCode(() => StageNumber.FIRST.isMultipleOf(interval), 'INVALID_ARGUMENT');
  });
});
