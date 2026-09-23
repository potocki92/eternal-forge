import { describe, expect, it } from 'vitest';
import { CHARACTER_LEVEL_MAX } from '../character/character.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { MAX_LEVELS_PER_GAIN, applyExperience, experienceToNextLevel } from './level.js';

const rules = getGameRules(GAME_RULES_VERSION).progression;
const n = (value: number | string): HugeNumber =>
  typeof value === 'number' ? HugeNumber.fromNumber(value) : HugeNumber.fromDecimal(value);

describe('experienceToNextLevel — rules v1: floor(10 × 1.10^(L − 1))', () => {
  it.each([
    [1, '10'],
    [2, '11'],
    [3, '12'], // 12.1, floored
    [4, '13'], // 13.31
    [11, '25'], // 25.937…
  ])('level %i needs %s', (level, expected) => {
    expect(experienceToNextLevel(level, rules).eq(n(expected))).toBe(true);
  });

  it('grows without bound and stays a whole amount at very high levels', () => {
    const high = experienceToNextLevel(1_000_000, rules);
    expect(high.isInteger()).toBe(true);
    expect(high.gt(experienceToNextLevel(999_999, rules))).toBe(true);
  });

  it.each([0, -1, 1.5, CHARACTER_LEVEL_MAX + 1])('rejects level %s', (level) => {
    expect(() => experienceToNextLevel(level, rules)).toThrow(GameCoreError);
  });
});

describe('applyExperience', () => {
  it('banks experience below the requirement', () => {
    expect(applyExperience({ level: 1, experience: n(4) }, n(5), rules)).toEqual({
      level: 1,
      experience: n(9),
      levelsGained: 0,
    });
  });

  it('levels up exactly at the requirement and keeps nothing extra', () => {
    expect(applyExperience({ level: 1, experience: n(7) }, n(3), rules)).toEqual({
      level: 2,
      experience: HugeNumber.ZERO,
      levelsGained: 1,
    });
  });

  it('spends each level’s requirement in turn and keeps the remainder', () => {
    // 10 (1→2) + 11 (2→3) + 12 (3→4) = 33; 40 − 33 = 7 towards level 5.
    expect(applyExperience({ level: 1, experience: HugeNumber.ZERO }, n(40), rules)).toEqual({
      level: 4,
      experience: n(7),
      levelsGained: 3,
    });
  });

  it('gaining nothing changes nothing', () => {
    const progress = { level: 7, experience: n(3) };
    expect(applyExperience(progress, HugeNumber.ZERO, rules)).toEqual({
      ...progress,
      levelsGained: 0,
    });
  });

  it('bounds one gain to MAX_LEVELS_PER_GAIN and banks the rest for the next gain', () => {
    const enormous = n('1e400');
    const first = applyExperience({ level: 1, experience: HugeNumber.ZERO }, enormous, rules);

    expect(first.levelsGained).toBe(MAX_LEVELS_PER_GAIN);
    expect(first.level).toBe(1 + MAX_LEVELS_PER_GAIN);
    expect(first.experience.gte(experienceToNextLevel(first.level, rules))).toBe(true);

    const next = applyExperience(first, HugeNumber.ZERO, rules);
    expect(next.levelsGained).toBeGreaterThan(0);
  });

  it('stops at the maximum level and keeps the experience', () => {
    const atMax = applyExperience(
      { level: CHARACTER_LEVEL_MAX, experience: HugeNumber.ZERO },
      n('1e2000000000'),
      rules,
    );
    expect(atMax).toEqual({
      level: CHARACTER_LEVEL_MAX,
      experience: n('1e2000000000'),
      levelsGained: 0,
    });
  });

  it('reaches the maximum level from just below it', () => {
    const below = CHARACTER_LEVEL_MAX - 1;
    const result = applyExperience(
      { level: below, experience: HugeNumber.ZERO },
      experienceToNextLevel(below, rules),
      rules,
    );
    expect(result.level).toBe(CHARACTER_LEVEL_MAX);
    expect(result.levelsGained).toBe(1);
  });

  it.each([
    ['negative stored experience', { level: 1, experience: n(-1) }, n(1)],
    ['fractional stored experience', { level: 1, experience: n('0.5') }, n(1)],
    ['a negative gain', { level: 1, experience: n(0) }, n(-1)],
    ['a fractional gain', { level: 1, experience: n(0) }, n('1.5')],
    ['level 0', { level: 0, experience: n(0) }, n(1)],
  ])('rejects %s', (_label, progress, gain) => {
    expect(() => applyExperience(progress, gain, rules)).toThrow(GameCoreError);
  });
});
