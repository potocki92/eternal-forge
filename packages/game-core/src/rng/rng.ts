import { GameCoreError } from '../errors.js';

/**
 * Deterministic random number source for gameplay (ADR-005, ADR-015).
 *
 * Gameplay code receives an `Rng` and never touches `Math.random()`. The same
 * seed always produces the same sequence on every engine: the generator uses
 * only 32-bit integer operations (`Math.imul`, shifts, xor) that ECMAScript
 * specifies exactly.
 */
export interface Rng {
  /** Uniform integer in `[0, 2^32)`. */
  nextUint32(): number;
  /** Uniform integer in `[0, maxExclusive)`, without modulo bias. */
  nextInt(maxExclusive: number): number;
  /**
   * `true` with probability `basisPoints / 10_000`. Always consumes exactly one
   * draw, even at 0 or 10 000, so the stream stays aligned when a chance
   * changes between two simulations.
   */
  chance(basisPoints: number): boolean;
}

export type RngState = readonly [number, number, number, number];

/** Upper bound on seed length; seeds are opaque server-side identifiers. */
export const MAX_SEED_LENGTH = 256;

const UINT32_RANGE = 4_294_967_296; // 2^32, as a literal: Number `**` is engine-approximated
const BASIS_POINTS_SCALE = 10_000;

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/**
 * cyrb128: a 128-bit non-cryptographic string hash built from `Math.imul` and
 * xor, over UTF-16 code units. It spreads any seed string across the full
 * generator state. Seeds are chosen by the server, never by a client
 * (ADR-005), so a cryptographic hash is not required.
 */
function hashString(text: string): RngState {
  let h1 = 1_779_033_703;
  let h2 = 3_144_134_277;
  let h3 = 1_013_904_242;
  let h4 = 2_773_480_762;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597_399_067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2_869_860_233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951_274_213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2_716_044_179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597_399_067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2_869_860_233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951_274_213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2_716_044_179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function validateSeed(seed: string): void {
  if (seed.length === 0 || seed.length > MAX_SEED_LENGTH) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Seed must be a string of 1 to ${MAX_SEED_LENGTH} characters.`,
    );
  }
}

function toHex(word: number): string {
  return word.toString(16).padStart(8, '0');
}

/**
 * Derives an independent child seed, such as one per stage of a run.
 *
 * Labels are length-prefixed before hashing, so `("a/b", "c")` and
 * `("a", "b/c")` cannot collide by concatenation. The result is 32 hex
 * characters regardless of nesting depth.
 */
export function deriveSeed(seed: string, ...labels: readonly (string | number)[]): string {
  validateSeed(seed);
  const encoded = [seed, ...labels.map(String)].map((part) => `${part.length}:${part}`).join('|');
  return hashString(encoded).map(toHex).join('');
}

/**
 * xoshiro128** 1.1 (Blackman and Vigna). Small, fast, statistically strong for
 * simulation use, and defined entirely in 32-bit integer operations.
 *
 * The algorithm is part of the game rules: changing it changes every seeded
 * outcome and requires a `GAME_RULES_VERSION` bump.
 */
export class Xoshiro128StarStar implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(state: RngState) {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }

  public static fromSeed(seed: string): Xoshiro128StarStar {
    validateSeed(seed);
    return Xoshiro128StarStar.fromState(hashString(seed));
  }

  /**
   * Restores a generator from raw state. The all-zero state is a fixed point of
   * the generator and is rejected.
   */
  public static fromState(state: RngState): Xoshiro128StarStar {
    if (state.some((word) => !Number.isInteger(word) || word < 0 || word >= UINT32_RANGE)) {
      throw new GameCoreError('INVALID_ARGUMENT', 'RNG state words must be unsigned 32-bit.');
    }
    if (state.every((word) => word === 0)) {
      throw new GameCoreError('INVALID_ARGUMENT', 'RNG state must not be all zero.');
    }
    return new Xoshiro128StarStar(state);
  }

  public getState(): RngState {
    return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0];
  }

  public nextUint32(): number {
    const result = Math.imul(rotateLeft(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const shifted = this.s1 << 9;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= shifted;
    this.s3 = rotateLeft(this.s3, 11);

    return result;
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new GameCoreError('INVALID_ARGUMENT', 'maxExclusive must be an integer in [1, 2^32].');
    }
    // Reject the incomplete top block so every result is equally likely.
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    for (;;) {
      const draw = this.nextUint32();
      if (draw < limit) {
        return draw % maxExclusive;
      }
    }
  }

  public chance(basisPoints: number): boolean {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_SCALE) {
      throw new GameCoreError(
        'INVALID_ARGUMENT',
        'Chance must be integer basis points in [0, 10000].',
      );
    }
    return this.nextInt(BASIS_POINTS_SCALE) < basisPoints;
  }
}

/** Creates the project's standard deterministic RNG from a seed string. */
export function createRng(seed: string): Rng {
  return Xoshiro128StarStar.fromSeed(seed);
}
