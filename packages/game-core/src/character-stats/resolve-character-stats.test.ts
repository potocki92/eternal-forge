import { describe, expect, it } from 'vitest';

import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { getGameRules } from '../rules/index.js';
import { deriveBaseCharacterStats } from './character-stats.js';
import { resolveCharacterStats } from './resolve-character-stats.js';
import type { StatModifier } from './stat-modifier.js';

const n = (value: string | number): HugeNumber =>
  typeof value === 'number' ? HugeNumber.fromNumber(value) : HugeNumber.fromDecimal(value);

const base = {
  maxHealth: n(100),
  damage: n(20),
  attackSpeedBp: 10_000,
  criticalChanceBp: 500,
  criticalDamageBp: 15_000,
} as const;

const item = (id: string) => ({ type: 'ITEM_INSTANCE' as const, id });

describe('deriveBaseCharacterStats', () => {
  it('derives the current level-only values from the supplied versioned rules', () => {
    const stats = deriveBaseCharacterStats(3, getGameRules(2));
    expect(stats.maxHealth.toString()).toBe('1.21e2');
    expect(stats.damage.toString()).toBe('1.21e1');
    expect(stats.attackSpeedBp).toBe(10_000);
    expect(stats.criticalChanceBp).toBe(500);
    expect(stats.criticalDamageBp).toBe(15_000);
  });

  it.each([0, -1, 1.5, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid level %s',
    (level) => {
      expect(() => deriveBaseCharacterStats(level, getGameRules(2))).toThrow(GameCoreError);
    },
  );
});

describe('resolveCharacterStats', () => {
  it('returns equal values for zero modifiers without reusing the input object', () => {
    const result = resolveCharacterStats(base, []);
    expect(result).not.toBe(base);
    expect(result).toEqual(base);
  });

  it('applies flat values before one additive percentage pool', () => {
    const modifiers: StatModifier[] = [
      { stat: 'DAMAGE', operation: 'FLAT', value: n(40), source: item('weapon') },
      {
        stat: 'DAMAGE',
        operation: 'FLAT',
        value: n(20),
        source: { type: 'AFFIX', id: 'rare-power' },
      },
      {
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: 1_000,
        source: { type: 'PASSIVE', id: 'strength' },
      },
    ];
    expect(resolveCharacterStats(base, modifiers).damage.eq(n(88))).toBe(true);
  });

  it('uses basis points and half-to-even rounding for rate stats', () => {
    const modifier: StatModifier = {
      stat: 'ATTACK_SPEED',
      operation: 'ADDITIVE_PERCENT',
      value: 5_000,
      source: item('speed'),
    };
    expect(resolveCharacterStats({ ...base, attackSpeedBp: 3 }, [modifier]).attackSpeedBp).toBe(4);
    expect(resolveCharacterStats({ ...base, attackSpeedBp: 5 }, [modifier]).attackSpeedBp).toBe(8);
  });

  it('is independent of modifier input ordering and does not mutate either input', () => {
    const modifiers: StatModifier[] = [
      { stat: 'DAMAGE', operation: 'FLAT', value: n('1e80'), source: item('z') },
      { stat: 'DAMAGE', operation: 'FLAT', value: n('3e79'), source: item('a') },
      {
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: 2_500,
        source: { type: 'BUFF', id: 'b' },
      },
      {
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: -500,
        source: { type: 'DEBUFF', id: 'a' },
      },
    ];
    const snapshot = modifiers.slice();
    const forward = resolveCharacterStats(base, modifiers);
    const reversed = resolveCharacterStats(base, modifiers.toReversed());
    expect(forward.damage.toString()).toBe(reversed.damage.toString());
    expect(modifiers).toEqual(snapshot);
    expect(base.damage.eq(n(20))).toBe(true);
  });

  it('supports HugeNumber magnitudes far beyond the safe integer range', () => {
    const result = resolveCharacterStats({ ...base, damage: n('9.99999999999999999e1000000') }, [
      {
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: 10_000,
        source: { type: 'SKILL', id: 'double' },
      },
    ]);
    expect(result.damage.toString()).toBe('2e1000001');
  });

  it('clamps negative results and critical chance to domain invariants', () => {
    const modifiers: StatModifier[] = [
      { stat: 'MAX_HEALTH', operation: 'FLAT', value: n(-500), source: item('health') },
      { stat: 'DAMAGE', operation: 'FLAT', value: n(-500), source: item('damage') },
      {
        stat: 'ATTACK_SPEED',
        operation: 'ADDITIVE_PERCENT',
        value: -20_000,
        source: item('speed'),
      },
      {
        stat: 'CRITICAL_CHANCE',
        operation: 'FLAT',
        value: 50_000,
        source: item('critical'),
      },
      {
        stat: 'CRITICAL_DAMAGE',
        operation: 'FLAT',
        value: -50_000,
        source: item('critical-damage'),
      },
    ];
    const result = resolveCharacterStats(base, modifiers);
    expect(result.maxHealth.eq(HugeNumber.ONE)).toBe(true);
    expect(result.damage.isZero()).toBe(true);
    expect(result.attackSpeedBp).toBe(1);
    expect(result.criticalChanceBp).toBe(10_000);
    expect(result.criticalDamageBp).toBe(10_000);
  });

  it('rejects invalid values, runtime type mismatches, and non-canonical sources', () => {
    const unsafe: StatModifier = {
      stat: 'CRITICAL_CHANCE',
      operation: 'FLAT',
      value: 1.5,
      source: item('chance'),
    };
    expect(() => resolveCharacterStats(base, [unsafe])).toThrow(GameCoreError);

    const wrongRuntimeType = {
      stat: 'DAMAGE',
      operation: 'FLAT',
      value: 10,
      source: item('damage'),
    } as unknown as StatModifier;
    expect(() => resolveCharacterStats(base, [wrongRuntimeType])).toThrow(GameCoreError);

    const badSource: StatModifier = {
      stat: 'DAMAGE',
      operation: 'ADDITIVE_PERCENT',
      value: 100,
      source: item('not canonical'),
    };
    expect(() => resolveCharacterStats(base, [badSource])).toThrow(GameCoreError);
    expect(() => resolveCharacterStats({ ...base, attackSpeedBp: 0 }, [])).toThrow(GameCoreError);
  });
});
