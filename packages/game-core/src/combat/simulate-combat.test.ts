import { describe, expect, it } from 'vitest';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { createRng } from '../rng/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import type { CombatStats } from '../stats/combat-stats.js';
import { simulateCombat, type SimulateCombatInput } from './simulate-combat.js';

const n = (value: number): HugeNumber => HugeNumber.fromNumber(value);

function stats(overrides: Partial<CombatStats> = {}): CombatStats {
  return {
    maxHealth: n(100),
    damage: n(10),
    attackSpeedBp: 10_000,
    critChanceBp: 0,
    critDamageBp: 15_000,
    ...overrides,
  };
}

function input(
  player: Partial<CombatStats>,
  enemy: Partial<CombatStats>,
  seed = 'test',
): SimulateCombatInput {
  return {
    player: { stats: stats(player) },
    enemy: { stats: stats(enemy) },
    seed,
    rulesVersion: GAME_RULES_VERSION,
  };
}

describe('simulateCombat — hand-verified timeline', () => {
  it('resolves attacks in time order and ends when the enemy dies', () => {
    // Player: 10 damage at 1.0/s. Enemy: 40 health, 4 damage at 0.8/s.
    // Player hits at 1, 2, 3, 4 s; enemy hits at 1.25, 2.5, 3.75 s.
    const result = simulateCombat(
      input({}, { maxHealth: n(40), damage: n(4), attackSpeedBp: 8_000 }),
    );

    expect(result.events.map((event) => [event.timeMs, event.attacker])).toEqual([
      [1000, 'PLAYER'],
      [1250, 'ENEMY'],
      [2000, 'PLAYER'],
      [2500, 'ENEMY'],
      [3000, 'PLAYER'],
      [3750, 'ENEMY'],
      [4000, 'PLAYER'],
    ]);
    expect(result.events.map((event) => event.targetHealth.toString())).toEqual([
      '3e1',
      '9.6e1',
      '2e1',
      '9.2e1',
      '1e1',
      '8.8e1',
      '0',
    ]);
    expect(result.outcome).toBe('WIN');
    expect(result.endReason).toBe('ENEMY_DEFEATED');
    expect(result.durationMs).toBe(4000);
    expect(result.player).toEqual({
      attacks: 4,
      criticalHits: 0,
      damageDealt: n(40),
      remainingHealth: n(88),
    });
    expect(result.enemy.attacks).toBe(3);
    expect(result.enemy.remainingHealth.isZero()).toBe(true);
    expect(result.rulesVersion).toBe(GAME_RULES_VERSION);
    expect(result.seed).toBe('test');
  });

  it('resolves simultaneous attacks player first', () => {
    const result = simulateCombat(input({ damage: n(100) }, { damage: n(100) }));
    expect(result.events).toHaveLength(1);
    expect(result.outcome).toBe('WIN');
  });

  it('reports a player defeat as a loss', () => {
    const result = simulateCombat(input({ damage: n(1) }, { damage: n(50) }));
    expect(result.outcome).toBe('LOSS');
    expect(result.endReason).toBe('PLAYER_DEFEATED');
    expect(result.player.remainingHealth.isZero()).toBe(true);
    expect(result.durationMs).toBe(2000);
  });

  it('counts overkill in damage dealt but never drops health below zero', () => {
    const result = simulateCombat(input({ damage: n(250) }, {}));
    expect(result.player.damageDealt).toEqual(n(250));
    expect(result.enemy.remainingHealth).toEqual(HugeNumber.ZERO);
  });

  it('loses on the time limit, with attacks landing exactly at the limit included', () => {
    const result = simulateCombat(
      input({ damage: HugeNumber.ZERO }, { damage: HugeNumber.ZERO, attackSpeedBp: 8_000 }),
    );
    expect(result.outcome).toBe('LOSS');
    expect(result.endReason).toBe('TIME_LIMIT');
    expect(result.durationMs).toBe(30_000);
    expect(result.player.attacks).toBe(30); // the 30th lands at exactly 30.000 s
    expect(result.enemy.attacks).toBe(24);
  });
});

describe('simulateCombat — critical hits, attack speed and caps', () => {
  it('applies critical damage exactly', () => {
    const result = simulateCombat(
      input({ damage: n(7), critChanceBp: 10_000 }, { maxHealth: n(21), damage: HugeNumber.ZERO }),
    );
    const playerHits = result.events.filter((event) => event.attacker === 'PLAYER');
    expect(playerHits.map((event) => event.damage.toString())).toEqual(['1.05e1', '1.05e1']);
    expect(result.player.criticalHits).toBe(2);
  });

  it('draws exactly one RNG value per attack, in attack order', () => {
    const seed = 'crit-stream';
    const result = simulateCombat(
      input(
        { critChanceBp: 5_000, damage: n(1) },
        { critChanceBp: 5_000, damage: n(1), maxHealth: n(1_000) },
        seed,
      ),
    );
    const rng = createRng(seed);
    expect(result.events.length).toBeGreaterThan(10);
    for (const event of result.events) {
      expect(event.critical).toBe(rng.chance(5_000));
    }
  });

  it('caps attack speed and critical chance at the rule limits', () => {
    const result = simulateCombat(
      input(
        { attackSpeedBp: 1_000_000, critChanceBp: 50_000, damage: n(1) },
        { damage: HugeNumber.ZERO, maxHealth: HugeNumber.fromDecimal('4.5') },
      ),
    );
    // Capped at 10 attacks per second and 100% critical chance: three 1.5
    // critical hits, the third landing at 300 ms.
    expect(result.events.map((event) => event.timeMs)).toEqual([100, 200, 300]);
    expect(result.player.criticalHits).toBe(3);
  });

  it('handles fractional attack intervals without drift', () => {
    // 3 attacks per second: 333, 666, 1000 ms. The exact order against a
    // 1-per-second enemy is decided without rounding.
    const result = simulateCombat(
      input({ attackSpeedBp: 30_000, damage: n(1) }, { maxHealth: n(3), damage: HugeNumber.ZERO }),
    );
    expect(result.events.map((event) => [event.timeMs, event.attacker])).toEqual([
      [333, 'PLAYER'],
      [666, 'PLAYER'],
      [1000, 'PLAYER'],
    ]);
  });

  it('works with values far beyond the float64 range', () => {
    const huge = HugeNumber.parse('1e5000');
    const result = simulateCombat(
      input(
        { maxHealth: huge, damage: HugeNumber.parse('5e4999') },
        { maxHealth: huge, damage: HugeNumber.parse('1e4999') },
      ),
    );
    expect(result.outcome).toBe('WIN');
    // Player hits at 1 s and 2 s; the enemy's single hit at 1 s lands after
    // the player's (ties resolve player first).
    expect(result.player.attacks).toBe(2);
    expect(result.enemy.attacks).toBe(1);
    expect(result.player.remainingHealth.toString()).toBe('9e4999');
  });
});

describe('simulateCombat — determinism', () => {
  const scenario = (seed: string): SimulateCombatInput =>
    input(
      { critChanceBp: 3_000, damage: HugeNumber.fromDecimal('12.5'), attackSpeedBp: 13_000 },
      { critChanceBp: 1_500, maxHealth: n(400), damage: n(6), attackSpeedBp: 9_000 },
      seed,
    );

  it('same input + same seed + same rules version = identical CombatResult', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      const first = simulateCombat(scenario(seed));
      const second = simulateCombat(scenario(seed));
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('different seeds change the critical-hit stream', () => {
    const fingerprints = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) =>
        simulateCombat(scenario(seed))
          .events.map((event) => (event.critical ? '1' : '0'))
          .join(''),
      ),
    );
    expect(fingerprints.size).toBeGreaterThan(1);
  });

  it('does not mutate its input', () => {
    const frozen = scenario('immutable');
    Object.freeze(frozen.player.stats);
    Object.freeze(frozen.enemy.stats);
    const before = JSON.stringify(frozen);
    simulateCombat(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('simulateCombat — validation', () => {
  function code(action: () => unknown): string | undefined {
    try {
      action();
    } catch (error) {
      return error instanceof GameCoreError ? error.code : 'UNEXPECTED';
    }
    return undefined;
  }

  it('rejects an unsupported rules version', () => {
    expect(code(() => simulateCombat({ ...input({}, {}), rulesVersion: 0 }))).toBe(
      'UNSUPPORTED_RULES_VERSION',
    );
    expect(code(() => simulateCombat({ ...input({}, {}), rulesVersion: 999 }))).toBe(
      'UNSUPPORTED_RULES_VERSION',
    );
  });

  it.each<[string, Partial<CombatStats>, string]>([
    ['negative damage', { damage: n(-1) }, 'NEGATIVE_VALUE'],
    ['negative health', { maxHealth: n(-1) }, 'NEGATIVE_VALUE'],
    ['zero health', { maxHealth: HugeNumber.ZERO }, 'INVALID_ARGUMENT'],
    ['zero attack speed', { attackSpeedBp: 0 }, 'INVALID_ARGUMENT'],
    ['fractional attack speed', { attackSpeedBp: 1.5 }, 'INVALID_ARGUMENT'],
    ['negative crit chance', { critChanceBp: -1 }, 'INVALID_ARGUMENT'],
    ['crit damage below 100%', { critDamageBp: 9_999 }, 'INVALID_ARGUMENT'],
    ['NaN crit damage', { critDamageBp: Number.NaN }, 'INVALID_ARGUMENT'],
  ])('rejects %s on either side', (_name, override, expected) => {
    expect(code(() => simulateCombat(input(override, {})))).toBe(expected);
    expect(code(() => simulateCombat(input({}, override)))).toBe(expected);
  });

  it('rejects an invalid seed', () => {
    expect(code(() => simulateCombat(input({}, {}, '')))).toBe('INVALID_ARGUMENT');
  });
});
