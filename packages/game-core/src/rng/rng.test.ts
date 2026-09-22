import { describe, expect, it } from 'vitest';
import { GameCoreError } from '../errors.js';
import { MAX_SEED_LENGTH, Xoshiro128StarStar, createRng, deriveSeed } from './rng.js';

function draw(seed: string, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

/*
 * Expected values below were computed by an independent Python implementation
 * of xoshiro128** and cyrb128. They are golden: a change is a rules change and
 * requires a GAME_RULES_VERSION bump.
 */
describe('Xoshiro128StarStar — reference vectors', () => {
  it('matches the reference xoshiro128** output for state [1, 2, 3, 4]', () => {
    const rng = Xoshiro128StarStar.fromState([1, 2, 3, 4]);
    const output = Array.from({ length: 10 }, () => rng.nextUint32());
    expect(output).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597,
      4258142804,
    ]);
  });

  it.each([
    [
      'eternal-forge',
      [1457699835, 2641571600, 3141332094, 3101690509],
      [
        2678253649, 1058609505, 583589812, 640877313, 3714772902, 1391044023, 3903292191,
        1287970810,
      ],
    ],
    [
      'a',
      [1589175524, 148824423, 2405369273, 1476957317],
      [
        2530184774, 2189761047, 2512095604, 2353053759, 215084874, 1022445775, 3696420500,
        533296308,
      ],
    ],
    [
      'zażółć 🐉',
      [4270917944, 259259960, 4080545480, 589835112],
      [2983718230, 1008997439, 398198937, 495281104, 1233643289, 828008963, 3747043589, 774463200],
    ],
  ])('seeds %j into a fixed state and stream', (seed, state, stream) => {
    expect(Xoshiro128StarStar.fromSeed(seed).getState()).toEqual(state);
    expect(draw(seed, 8)).toEqual(stream);
  });
});

describe('Xoshiro128StarStar — reproducibility', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draw('run-42', 1_000)).toEqual(draw('run-42', 1_000));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw('run-42', 16)).not.toEqual(draw('run-43', 16));
  });

  it('resumes exactly from a captured state', () => {
    const original = Xoshiro128StarStar.fromSeed('resume');
    original.nextUint32();
    const resumed = Xoshiro128StarStar.fromState(original.getState());
    expect(Array.from({ length: 50 }, () => resumed.nextUint32())).toEqual(
      Array.from({ length: 50 }, () => original.nextUint32()),
    );
  });

  it('only ever yields unsigned 32-bit integers', () => {
    for (const value of draw('range', 10_000)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });
});

describe('Xoshiro128StarStar — bounded integers and chances', () => {
  it('stays within [0, maxExclusive)', () => {
    const rng = createRng('bounded');
    for (const max of [1, 2, 3, 7, 10_000, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 500; i += 1) {
        const value = rng.nextInt(max);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    }
  });

  it('is close to uniform over a small range (fixed seed, not flaky)', () => {
    const rng = createRng('uniformity');
    const buckets = Array.from({ length: 10 }, () => 0);
    const samples = 100_000;
    for (let i = 0; i < samples; i += 1) {
      const bucket = rng.nextInt(10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    // Chi-square with 9 degrees of freedom; 27.9 is the p = 0.001 critical value.
    const expected = samples / 10;
    const chiSquare = buckets.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(27.9);
  });

  it('honours chance boundaries and consumes one draw per call', () => {
    const a = createRng('chance');
    const b = createRng('chance');
    for (let i = 0; i < 1_000; i += 1) {
      expect(a.chance(0)).toBe(false);
      expect(b.chance(10_000)).toBe(true);
    }
    // Both consumed exactly the same number of draws.
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('hits a 25% chance about a quarter of the time', () => {
    const rng = createRng('quarter');
    let hits = 0;
    for (let i = 0; i < 40_000; i += 1) {
      hits += rng.chance(2_500) ? 1 : 0;
    }
    expect(hits).toBeGreaterThan(9_600);
    expect(hits).toBeLessThan(10_400);
  });

  it.each([0, -1, 1.5, 2 ** 32 + 1, Number.NaN])('rejects maxExclusive %s', (max) => {
    expect(() => createRng('x').nextInt(max)).toThrow(GameCoreError);
  });

  it.each([-1, 10_001, 0.5, Number.NaN])('rejects chance %s', (basisPoints) => {
    expect(() => createRng('x').chance(basisPoints)).toThrow(GameCoreError);
  });
});

describe('seeds', () => {
  it('rejects empty and oversized seeds', () => {
    expect(() => createRng('')).toThrow(GameCoreError);
    expect(() => createRng('x'.repeat(MAX_SEED_LENGTH + 1))).toThrow(GameCoreError);
    expect(() => createRng('x'.repeat(MAX_SEED_LENGTH))).not.toThrow();
  });

  it('rejects invalid raw state', () => {
    expect(() => Xoshiro128StarStar.fromState([0, 0, 0, 0])).toThrow(GameCoreError);
    expect(() => Xoshiro128StarStar.fromState([1, 2, 3, 2 ** 32])).toThrow(GameCoreError);
    expect(() => Xoshiro128StarStar.fromState([1, 2, 3, -1])).toThrow(GameCoreError);
  });

  it('derives stable, fixed-length child seeds', () => {
    const child = deriveSeed('run-42', 'stage', 7);
    expect(child).toMatch(/^[0-9a-f]{32}$/u);
    expect(deriveSeed('run-42', 'stage', 7)).toBe(child);
    expect(deriveSeed('run-42', 'stage', 8)).not.toBe(child);
    expect(deriveSeed('run-43', 'stage', 7)).not.toBe(child);
  });

  it('does not collide when labels are re-split', () => {
    expect(deriveSeed('a/b', 'c')).not.toBe(deriveSeed('a', 'b/c'));
    expect(deriveSeed('ab', 'c')).not.toBe(deriveSeed('a', 'bc'));
    expect(deriveSeed('a', 1)).toBe(deriveSeed('a', '1'));
  });
});
