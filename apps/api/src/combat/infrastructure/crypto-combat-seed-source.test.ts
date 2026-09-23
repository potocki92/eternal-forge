import { MAX_SEED_LENGTH } from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import { CryptoCombatSeedSource } from './crypto-combat-seed-source.js';

describe('CryptoCombatSeedSource', () => {
  const source = new CryptoCombatSeedSource();

  it('produces 256-bit base64url seeds that fit the column and Game Core', () => {
    const seed = source.next();

    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(seed.length).toBeLessThanOrEqual(64);
    expect(seed.length).toBeLessThanOrEqual(MAX_SEED_LENGTH);
  });

  it('never repeats', () => {
    const seeds = new Set(Array.from({ length: 1_000 }, () => source.next()));
    expect(seeds.size).toBe(1_000);
  });
});
