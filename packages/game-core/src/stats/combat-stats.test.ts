import { describe, expect, it } from 'vitest';
import { calculateHitDamage } from '../combat/damage.js';
import { HugeNumber } from '../huge-number/index.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { applyCombatCaps, validateCombatStats, type CombatStats } from './combat-stats.js';

const base: CombatStats = {
  maxHealth: HugeNumber.fromNumber(100),
  damage: HugeNumber.fromNumber(10),
  attackSpeedBp: 10_000,
  critChanceBp: 500,
  critDamageBp: 15_000,
};

describe('combat stats', () => {
  it('accepts valid stats unchanged', () => {
    expect(validateCombatStats(base, 'player')).toBe(base);
    expect(
      validateCombatStats({ ...base, damage: HugeNumber.ZERO }, 'player').damage.isZero(),
    ).toBe(true);
  });

  it('names the offending field', () => {
    expect(() => validateCombatStats({ ...base, attackSpeedBp: 0 }, 'enemy')).toThrow(
      'enemy.attackSpeedBp must be a safe integer of at least 1.',
    );
    expect(() =>
      validateCombatStats({ ...base, damage: HugeNumber.fromNumber(-5) }, 'enemy'),
    ).toThrow('enemy.damage must not be negative.');
  });

  it('caps attack speed and critical chance, leaving everything else alone', () => {
    const rules = getGameRules(GAME_RULES_VERSION).combat;
    const capped = applyCombatCaps(
      { ...base, attackSpeedBp: rules.maxAttackSpeedBp + 1, critChanceBp: 20_000 },
      rules,
    );
    expect(capped.attackSpeedBp).toBe(rules.maxAttackSpeedBp);
    expect(capped.critChanceBp).toBe(rules.maxCritChanceBp);
    expect(capped.critDamageBp).toBe(base.critDamageBp);
    expect(applyCombatCaps(base, rules)).toEqual(base);
  });
});

describe('hit damage', () => {
  it('is the damage stat on a normal hit', () => {
    expect(calculateHitDamage(base, false)).toBe(base.damage);
  });

  it('scales by critical damage on a critical hit', () => {
    expect(calculateHitDamage(base, true).toString()).toBe('1.5e1');
    expect(calculateHitDamage({ ...base, critDamageBp: 34_500 }, true).toString()).toBe('3.45e1');
    const huge = { ...base, damage: HugeNumber.parse('1.23456789012345678e900') };
    expect(calculateHitDamage(huge, true).toString()).toBe('1.85185183518518517e900');
  });
});
