import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameCoreError, HugeNumber } from '../src/index.js';

/**
 * Golden vectors for HugeNumber (ADR-013, section 6).
 *
 * Expected values were produced by `fixtures/generate-huge-number-vectors.py`
 * with Python's `decimal` module, an implementation independent of the one
 * under test. A failing vector is either a bug or a rules change; a rules
 * change regenerates the fixture and bumps GAME_RULES_VERSION.
 */

interface GoldenVector {
  readonly op: 'fromDecimal' | 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'floor';
  readonly a: string;
  readonly b?: string;
  readonly expected?: string;
  readonly error?: string;
}

interface GoldenFixture {
  readonly precision: number;
  readonly rounding: string;
  readonly vectors: readonly GoldenVector[];
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/huge-number-vectors.json'), 'utf8'),
) as GoldenFixture;

function evaluate(vector: GoldenVector): HugeNumber {
  const b = vector.b ?? '';
  switch (vector.op) {
    case 'fromDecimal':
      return HugeNumber.fromDecimal(vector.a);
    case 'add':
      return HugeNumber.parse(vector.a).add(HugeNumber.parse(b));
    case 'sub':
      return HugeNumber.parse(vector.a).sub(HugeNumber.parse(b));
    case 'mul':
      return HugeNumber.parse(vector.a).mul(HugeNumber.parse(b));
    case 'div':
      return HugeNumber.parse(vector.a).div(HugeNumber.parse(b));
    case 'pow':
      return HugeNumber.parse(vector.a).pow(Number(b));
    case 'floor':
      return HugeNumber.parse(vector.a).floor();
  }
}

function describeVector(vector: GoldenVector): string {
  return `${vector.op}(${vector.a}${vector.b === undefined ? '' : `, ${vector.b}`})`;
}

describe('HugeNumber golden vectors', () => {
  it('match the precision and rounding the fixture was generated with', () => {
    expect(fixture.precision).toBe(18);
    expect(fixture.rounding).toBe('ROUND_HALF_EVEN');
    expect(fixture.vectors.length).toBeGreaterThan(100);
  });

  it.each(fixture.vectors.map((vector) => [describeVector(vector), vector] as const))(
    '%s',
    (_name, vector) => {
      if (vector.error === undefined) {
        const result = evaluate(vector);
        expect(result.toString()).toBe(vector.expected);
        // Every result is itself canonical and round-trips.
        expect(HugeNumber.parse(result.toString()).eq(result)).toBe(true);
        return;
      }
      expect(() => evaluate(vector)).toThrow(GameCoreError);
      try {
        evaluate(vector);
      } catch (error) {
        expect((error as GameCoreError).code).toBe(vector.error);
      }
    },
  );
});
