import { describe, expect, it } from 'vitest';
import { GAME_RULES_VERSION } from './rules-version.js';

describe('GAME_RULES_VERSION', () => {
  it('is a positive integer that can be persisted alongside a simulation', () => {
    expect(Number.isInteger(GAME_RULES_VERSION)).toBe(true);
    expect(GAME_RULES_VERSION).toBeGreaterThanOrEqual(1);
  });
});
