import type { CharacterStatDeltaDto, CharacterStatValuesDto } from '@eternal-forge/contracts';
import { describe, expect, it } from 'vitest';
import {
  STAT_ORDER,
  deltaDirection,
  deltaTone,
  describeStatDelta,
  formatAttackSpeed,
  formatPercent,
  formatStat,
  formatStatDelta,
  isUnchanged,
} from './stat-format';

const values: CharacterStatValuesDto = {
  maxHealth: '3.82e2',
  damage: '1.43e2',
  attackSpeedBp: 12_700,
  criticalChanceBp: 1_435,
  criticalDamageBp: 16_800,
};
const zero: CharacterStatDeltaDto = {
  maxHealth: '0',
  damage: '0',
  attackSpeedBp: 0,
  criticalChanceBp: 0,
  criticalDamageBp: 0,
};

describe('stat formatting', () => {
  it('shows every stat in player terms, never in basis points', () => {
    expect(STAT_ORDER.map((stat) => formatStat(values, stat))).toEqual([
      '143',
      '382',
      '1.27 / sec',
      '14.35%',
      '168.00%',
    ]);
  });

  it('formats late-game HugeNumbers without converting them to a float', () => {
    expect(formatStat({ ...values, damage: '1.45e37' }, 'DAMAGE')).toBe('1.45e37');
    expect(formatStat({ ...values, maxHealth: '9.87654321e123456' }, 'MAX_HEALTH')).toBe(
      '9.87e123456',
    );
    expect(formatStat({ ...values, damage: '1.24e4' }, 'DAMAGE')).toBe('12.4K');
  });

  it('reads attack speed as attacks per second, exactly, never as an interval', () => {
    expect(formatAttackSpeed(10_000)).toBe('1.00 / sec');
    expect(formatAttackSpeed(12_500)).toBe('1.25 / sec');
    expect(formatAttackSpeed(10_020)).toBe('1.002 / sec');
    expect(formatAttackSpeed(12_745)).toBe('1.2745 / sec');
    expect(formatAttackSpeed(100_000)).toBe('10.00 / sec');
  });

  it('shows Critical Damage as the total multiplier, not a bonus', () => {
    expect(formatStat({ ...values, criticalDamageBp: 15_000 }, 'CRITICAL_DAMAGE')).toBe('150.00%');
    expect(formatStat({ ...values, criticalDamageBp: 15_000 }, 'CRITICAL_DAMAGE')).not.toMatch(
      /^\+/u,
    );
    expect(formatPercent(1_234_567)).toBe('12,345.67%');
  });

  it('shows Critical Chance with its exact two decimals', () => {
    expect(formatPercent(500)).toBe('5.00%');
    expect(formatPercent(10_000)).toBe('100.00%');
    expect(formatPercent(7)).toBe('0.07%');
  });
});

describe('stat deltas', () => {
  const delta: CharacterStatDeltaDto = {
    maxHealth: '-3e1',
    damage: '1.8e1',
    attackSpeedBp: 1_200,
    criticalChanceBp: 370,
    criticalDamageBp: -700,
  };

  it('is signed, with its unit', () => {
    expect(STAT_ORDER.map((stat) => formatStatDelta(delta, stat))).toEqual([
      '+18',
      '-30',
      '+0.12 / sec',
      '+3.70%',
      '-7.00%',
    ]);
  });

  it('keeps huge differences exact in presentation', () => {
    expect(formatStatDelta({ ...zero, damage: '-2.5e40' }, 'DAMAGE')).toBe('-2.5e40');
  });

  it('marks direction and whether it helps, explicitly per stat', () => {
    expect(deltaDirection(delta, 'DAMAGE')).toBe('up');
    expect(deltaDirection(delta, 'MAX_HEALTH')).toBe('down');
    expect(deltaTone(delta, 'DAMAGE')).toBe('gain');
    expect(deltaTone(delta, 'MAX_HEALTH')).toBe('loss');
    expect(deltaTone(zero, 'DAMAGE')).toBe('none');
  });

  it('recognises zero exactly, for HugeNumbers and rates', () => {
    for (const stat of STAT_ORDER) expect(isUnchanged(zero, stat)).toBe(true);
    expect(isUnchanged(delta, 'DAMAGE')).toBe(false);
    expect(isUnchanged({ ...zero, damage: '1e-17' }, 'DAMAGE')).toBe(false);
  });

  it('describes a change in words for assistive technology', () => {
    expect(describeStatDelta(delta, 'DAMAGE')).toBe('Damage increases by 18');
    expect(describeStatDelta(delta, 'MAX_HEALTH')).toBe('Max Health decreases by 30');
    expect(describeStatDelta(delta, 'CRITICAL_CHANCE')).toBe('Critical Chance increases by 3.70%');
    expect(describeStatDelta(zero, 'ATTACK_SPEED')).toBe('Attack Speed does not change');
  });
});
