import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { resolveStageAttempt, type CharacterProgress } from '../progression/stage-attempt.js';
import type { StageProgress } from '../progression/stage-progress.js';
import { calculateStageRewards } from '../rewards/rewards.js';
import { deriveSeed } from '../rng/index.js';
import { getGameRules, type GameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { StageNumber } from '../stage/index.js';
import {
  MAX_OFFLINE_FIGHTS,
  offlineFarmStage,
  resolveOfflineProgress,
  resolveOfflineProgressUnder,
  type OfflineProgressResult,
} from './offline-progress.js';

const rules = getGameRules(GAME_RULES_VERSION);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CAP = rules.offline.capMs;

/** 2^53 + 1: the first integer a JavaScript `number` cannot hold. */
const BEYOND_SAFE_INTEGER = 9_007_199_254_740_993n;

function stages(current: bigint, reached: bigint, cleared: bigint | null): StageProgress {
  return {
    current: StageNumber.of(current),
    highestReached: StageNumber.of(reached),
    highestCleared: cleared === null ? null : StageNumber.of(cleared),
  };
}

function progress(level: number, stageProgress: StageProgress, gold = 0): CharacterProgress {
  return {
    level,
    experience: HugeNumber.ZERO,
    gold: HugeNumber.fromNumber(gold),
    stages: stageProgress,
  };
}

function offline(
  from: CharacterProgress,
  elapsedMs: number,
  seed = 'offline-test',
): OfflineProgressResult {
  return resolveOfflineProgress({
    progress: from,
    elapsedMs,
    seed,
    rulesVersion: GAME_RULES_VERSION,
  });
}

/**
 * The reference: the ordinary stage attempt in FARM mode on the farm stage,
 * fight after fight, stopping at the first fight that does not fit. It is
 * what a player tapping Fight on that stage, back to back, would get.
 */
function reference(from: CharacterProgress, elapsedMs: number, seed: string) {
  const target = offlineFarmStage(from.stages);
  if (target === null) {
    throw new Error('reference needs a farm stage');
  }
  const rewardedMs = Math.min(elapsedMs, CAP);
  let current: CharacterProgress = { ...from, stages: { ...from.stages, current: target } };
  let consumedMs = 0;
  let fights = 0;
  let wins = 0;
  for (;;) {
    const attempt = resolveStageAttempt({
      progress: current,
      mode: 'FARM',
      seed: deriveSeed(seed, 'offline', fights),
      rulesVersion: GAME_RULES_VERSION,
    });
    if (attempt.combat.durationMs > rewardedMs - consumedMs) {
      break;
    }
    consumedMs += attempt.combat.durationMs;
    fights += 1;
    wins += attempt.combat.outcome === 'WIN' ? 1 : 0;
    // A farm fight on a cleared stage never moves the stage progress.
    expect(attempt.after.stages).toEqual(current.stages);
    current = attempt.after;
  }
  return { fights, wins, consumedMs, after: current };
}

describe('offlineFarmStage — the safe farm target', () => {
  it.each([
    ['PROGRESS at the unbeaten boss frontier farms the last cleared stage', [10n, 10n, 9n], 9n],
    ['after a boss defeat, on the cleared stage below it', [9n, 10n, 9n], 9n],
    ['an intentional farm stage below the record is respected', [25n, 41n, 40n], 25n],
    ['farming the uncleared frontier boss falls back to the record', [100n, 100n, 99n], 99n],
    ['a reached but uncleared stage above the record is not fought', [7n, 9n, 5n], 5n],
    ['a cleared boss may be farmed', [10n, 11n, 10n], 10n],
  ] as const)('%s', (_name, [current, reached, cleared], expected) => {
    expect(offlineFarmStage(stages(current, reached, cleared))?.toBigInt()).toBe(expected);
  });

  it('has no target before the first clear', () => {
    expect(offlineFarmStage(stages(1n, 1n, null))).toBeNull();
    expect(offlineFarmStage(stages(7n, 7n, null))).toBeNull();
  });

  it('is exact beyond 2^53', () => {
    const beyond = stages(BEYOND_SAFE_INTEGER + 1n, BEYOND_SAFE_INTEGER + 1n, BEYOND_SAFE_INTEGER);
    expect(offlineFarmStage(beyond)?.toBigInt()).toBe(BEYOND_SAFE_INTEGER);
  });

  it('rejects stage progress that breaks its invariants', () => {
    expect(() => offlineFarmStage(stages(5n, 4n, 3n))).toThrow(GameCoreError);
  });
});

describe('resolveOfflineProgress — nothing to collect', () => {
  const pushing = progress(10, stages(10n, 10n, 9n), 50);

  it.each([0, 1, 700, MINUTE - 1])('fights nothing after %i ms away (TOO_SOON)', (elapsedMs) => {
    const result = offline(pushing, elapsedMs);
    expect(result.idleReason).toBe('TOO_SOON');
    expect(result.fights).toBe(0);
    expect(result.consumedMs).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.rewards.gold.isZero()).toBe(true);
    expect(result.target?.number.toBigInt()).toBe(9n);
  });

  it('fights nothing before the first clear, however long the absence', () => {
    const result = offline(progress(1, stages(1n, 1n, null)), 20 * HOUR);
    expect(result.idleReason).toBe('NO_CLEARED_STAGE');
    expect(result.target).toBeNull();
    expect(result.fights).toBe(0);
    expect(result.after).toEqual(result.before);
  });

  it('fights nothing on a valid stage the rule set cannot scale (2^53 + 1)', () => {
    const deep = stages(BEYOND_SAFE_INTEGER, BEYOND_SAFE_INTEGER + 1n, BEYOND_SAFE_INTEGER);
    const result = offline(progress(1, deep), 8 * HOUR);
    expect(result.idleReason).toBe('STAGE_NOT_PLAYABLE');
    expect(result.fights).toBe(0);
    expect(result.after.stages.current.toBigInt()).toBe(BEYOND_SAFE_INTEGER);
  });
});

describe('resolveOfflineProgress — farming', () => {
  it('fits at least one fight as soon as the minimum absence has passed', () => {
    // The minimum absence is at least the combat time limit, so every fight fits.
    expect(rules.offline.minimumAbsenceMs).toBeGreaterThanOrEqual(rules.combat.timeLimitMs);
    const result = offline(progress(10, stages(10n, 10n, 9n)), MINUTE);
    expect(result.idleReason).toBeNull();
    expect(result.fights).toBeGreaterThanOrEqual(1);
    expect(result.consumedMs).toBeLessThanOrEqual(MINUTE);
  });

  it.each([
    ['5 minutes', 5 * MINUTE],
    ['1 hour', HOUR],
    ['8 hours', 8 * HOUR],
  ])('matches back-to-back FARM attempts on the target over %s', (_name, elapsedMs) => {
    const from = progress(10, stages(10n, 10n, 9n), 17);
    const result = offline(from, elapsedMs, 'equivalence');
    const expected = reference(from, elapsedMs, 'equivalence');

    expect(result.fights).toBe(expected.fights);
    expect(result.wins).toBe(expected.wins);
    expect(result.consumedMs).toBe(expected.consumedMs);
    expect(result.after.level).toBe(expected.after.level);
    expect(result.after.experience.eq(expected.after.experience)).toBe(true);
    expect(result.after.gold.eq(expected.after.gold)).toBe(true);
    expect(result.levelsGained).toBe(expected.after.level - from.level);
    expect(result.capReached).toBe(false);
    expect(result.rewardedMs).toBe(elapsedMs);
  });

  it('keeps the unused remainder shorter than the next fight', () => {
    const from = progress(10, stages(10n, 10n, 9n));
    const result = offline(from, HOUR + 7_777);
    const unused = result.rewardedMs - result.consumedMs;
    expect(unused).toBeGreaterThanOrEqual(0);
    // Resolving exactly the consumed time reproduces the same fights: the
    // remainder held no complete fight.
    const exact = offline(from, result.consumedMs);
    expect(exact.fights).toBe(result.fights);
    expect(exact.after).toEqual(result.after);
  });

  it('levels up during the absence, and later fights use the new level', () => {
    const from = progress(1, stages(2n, 2n, 1n));
    const result = offline(from, HOUR, 'level-ups');
    expect(result.levelsGained).toBeGreaterThan(10);
    expect(result.after.level).toBe(1 + result.levelsGained);
    expect(result.fights).toBe(reference(from, HOUR, 'level-ups').fights);
  });

  it('simulates losses, which pay nothing', () => {
    // A level-9 hero that once cleared the stage-10 boss farms it offline:
    // it wins most fights and loses some.
    const from = progress(9, stages(11n, 11n, 10n));
    const result = offline(from, HOUR, 'losses');
    const perWin = calculateStageRewards(result.target!, rules.rewards);

    expect(result.target?.kind).toBe('BOSS');
    expect(result.losses).toBeGreaterThan(0);
    expect(result.wins).toBeGreaterThan(0);
    expect(result.wins + result.losses).toBe(result.fights);
    expect(result.rewards.gold.eq(perWin.gold.mul(HugeNumber.fromNumber(result.wins)))).toBe(true);
    expect(result.fights).toBe(reference(from, HOUR, 'losses').fights);
  });

  it('respects an intentional farm stage below the record', () => {
    const result = offline(progress(300, stages(25n, 41n, 40n)), HOUR);
    expect(result.target?.number.toBigInt()).toBe(25n);
    expect(result.after.stages).toEqual(stages(25n, 41n, 40n));
  });

  it('never fights, clears or unlocks the unbeaten frontier boss', () => {
    // Strong enough to beat the stage-10 boss — but it has never done so.
    const frontier = stages(10n, 10n, 9n);
    const result = offline(progress(60, frontier), 8 * HOUR);
    expect(result.target?.number.toBigInt()).toBe(9n);
    expect(result.target?.kind).toBe('REGULAR');
    expect(result.after.stages).toBe(frontier);
  });
});

describe('resolveOfflineProgress — the cap', () => {
  const from = progress(10, stages(10n, 10n, 9n));

  it('rewards exactly 8 hours without reaching the cap', () => {
    const result = offline(from, 8 * HOUR);
    expect(CAP).toBe(8 * HOUR);
    expect(result.capReached).toBe(false);
    expect(result.rewardedMs).toBe(8 * HOUR);
  });

  it.each([8 * HOUR + 1, 14 * HOUR + 32 * MINUTE, 30 * 24 * HOUR])(
    'caps %i ms away at 8 hours',
    (elapsedMs) => {
      const result = offline(from, elapsedMs, 'capped');
      expect(result.capReached).toBe(true);
      expect(result.elapsedMs).toBe(elapsedMs);
      expect(result.rewardedMs).toBe(CAP);
      expect(result.consumedMs).toBeLessThanOrEqual(CAP);
      // Everything beyond the cap is worth nothing: identical to exactly 8 hours.
      const atCap = offline(from, CAP, 'capped');
      expect(result.fights).toBe(atCap.fights);
      expect(result.after).toEqual(atCap.after);
    },
  );
});

describe('resolveOfflineProgress — numbers', () => {
  it('accumulates HugeNumber rewards exactly at a deep stage (10^9)', () => {
    const deep = 1_000_000_000n;
    const from = progress(1_200_000_000, stages(deep + 1n, deep + 1n, deep));
    const result = offline(from, 5 * MINUTE);
    const perWin = calculateStageRewards(result.target!, rules.rewards);

    expect(result.target?.number.toBigInt()).toBe(deep);
    expect(result.wins).toBeGreaterThan(0);
    expect(HugeNumber.parse(result.rewards.gold.toString()).eq(result.rewards.gold)).toBe(true);
    expect(result.after.gold.gte(perWin.gold)).toBe(true);
    expect(result.after.stages.current.toBigInt()).toBe(deep + 1n);
  });

  it('keeps gold growing from an already enormous balance', () => {
    const from: CharacterProgress = {
      ...progress(2_000, stages(1_001n, 1_001n, 1_000n)),
      gold: HugeNumber.fromDecimal('1e60'),
    };
    const result = offline(from, 8 * HOUR);
    expect(result.fights).toBe((8 * HOUR) / 1_000);
    expect(result.after.gold.gt(from.gold)).toBe(true);
    expect(result.rewards.gold.toString()).toMatch(/^[1-9](\.[0-9]*[1-9])?e[0-9]+$/u);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects elapsed time %s',
    (elapsedMs) => {
      expect(() => offline(progress(10, stages(10n, 10n, 9n)), elapsedMs)).toThrow(GameCoreError);
    },
  );

  it('rejects a fractional or negative stored balance', () => {
    const fractional = {
      ...progress(10, stages(10n, 10n, 9n)),
      gold: HugeNumber.fromDecimal('0.5'),
    };
    expect(() => offline(fractional, HOUR)).toThrow(GameCoreError);
  });
});

describe('resolveOfflineProgress — determinism and replay', () => {
  it('returns an identical result for identical input', () => {
    const from = progress(12, stages(12n, 12n, 11n), 3);
    const first = offline(from, 2 * HOUR, 'replay');
    const second = offline(from, 2 * HOUR, 'replay');
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('depends on the seed', () => {
    const from = progress(9, stages(11n, 11n, 10n));
    const results = ['a', 'b', 'c', 'd'].map((seed) => offline(from, HOUR, seed).wins);
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('pins a golden result under rules v1', () => {
    const result = offline(progress(10, stages(10n, 10n, 9n), 100), 3 * HOUR, 'golden-offline');
    expect({
      fights: result.fights,
      wins: result.wins,
      consumedMs: result.consumedMs,
      level: result.after.level,
      experience: result.after.experience.toString(),
      gold: result.after.gold.toString(),
      rewardGold: result.rewards.gold.toString(),
      rewardExperience: result.rewards.experience.toString(),
    }).toMatchInlineSnapshot(`
      {
        "consumedMs": 10800000,
        "experience": "4.523e3",
        "fights": 10599,
        "gold": "1.27288e5",
        "level": 68,
        "rewardExperience": "6.3594e4",
        "rewardGold": "1.27188e5",
        "wins": 10599,
      }
    `);
  });
});

describe('resolveOfflineProgress — bounded work', () => {
  it('never needs more than the fight limit under any registered rule set', () => {
    // The earliest any v1 combat can end is the first attack of either side.
    const firstAttackMs = (speedBp: number) =>
      Math.ceil((10_000 * 1_000) / Math.min(speedBp, rules.combat.maxAttackSpeedBp));
    const shortestCombatMs = Math.min(
      firstAttackMs(rules.character.baseStats.attackSpeedBp),
      firstAttackMs(rules.stages.regularArchetype.attackSpeedBp),
      firstAttackMs(rules.stages.bossArchetype.attackSpeedBp),
      rules.combat.timeLimitMs,
    );
    expect(shortestCombatMs).toBe(1_000);
    expect(Math.floor(CAP / shortestCombatMs)).toBeLessThanOrEqual(MAX_OFFLINE_FIGHTS);
  });

  it('refuses, rather than runs away, when a rule set would allow more fights', () => {
    const fast: GameRules = {
      ...rules,
      character: {
        ...rules.character,
        baseStats: {
          ...rules.character.baseStats,
          damage: HugeNumber.fromDecimal('1e30'),
          attackSpeedBp: rules.combat.maxAttackSpeedBp,
        },
      },
    };
    const input = {
      progress: progress(1, stages(2n, 2n, 1n)),
      elapsedMs: CAP,
      seed: 'too-fast',
      rulesVersion: GAME_RULES_VERSION,
    };
    expect(() => resolveOfflineProgressUnder(input, fast)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    // Half an hour at 100 ms per fight is still within the limit.
    const halfHour = resolveOfflineProgressUnder({ ...input, elapsedMs: 30 * MINUTE }, fast);
    expect(halfHour.fights).toBe((30 * MINUTE) / 100);
  });
});

describe('resolveOfflineProgress — a record equal to the frontier', () => {
  it('moves nothing even where an online farm win would unlock a stage', () => {
    // `highestCleared = highestReached` is storable but not produced by play:
    // every win unlocks the next stage. An online farm win here would raise
    // `highestReached`; offline progression never touches a record.
    const from = progress(10, stages(9n, 9n, 9n));
    const result = offline(from, HOUR);
    expect(result.wins).toBeGreaterThan(0);
    expect(result.after.stages).toBe(from.stages);
  });
});

describe('resolveOfflineProgress — invariants (property)', () => {
  const inputs = fc.record({
    level: fc.integer({ min: 1, max: 300 }),
    cleared: fc.option(fc.bigInt({ min: 1n, max: 150n }), { nil: null }),
    above: fc.bigInt({ min: 0n, max: 5n }),
    below: fc.bigInt({ min: 0n, max: 20n }),
    elapsedMs: fc.integer({ min: 0, max: 20 * MINUTE }),
    seed: fc.string({ minLength: 1, maxLength: 16 }),
  });

  it('never moves a stage or record, pays only wins and never exceeds the time', () => {
    fc.assert(
      fc.property(inputs, ({ level, cleared, above, below, elapsedMs, seed }) => {
        // Every reachable state: a win on stage s unlocks s + 1 (ADR-020).
        const reached = (cleared ?? 0n) + 1n + above;
        const current = reached - (below > reached - 1n ? reached - 1n : below);
        const from = progress(level, stages(current, reached, cleared));
        const result = offline(from, elapsedMs, seed);

        expect(result.after.stages).toBe(from.stages);
        expect(result.wins + result.losses).toBe(result.fights);
        expect(result.consumedMs).toBeLessThanOrEqual(result.rewardedMs);
        expect(result.rewardedMs).toBeLessThanOrEqual(Math.min(elapsedMs, CAP));
        expect(result.after.level).toBeGreaterThanOrEqual(from.level);
        expect(result.after.gold.gte(from.gold)).toBe(true);
        expect(result.idleReason === null).toBe(result.fights > 0);
        if (result.target !== null && cleared !== null) {
          expect(result.target.number.compare(StageNumber.of(cleared))).toBeLessThanOrEqual(0);
        }
        if (result.fights > 0) {
          const expected = reference(from, elapsedMs, seed);
          expect(result.fights).toBe(expected.fights);
          expect(result.after.gold.eq(expected.after.gold)).toBe(true);
          expect(result.after.level).toBe(expected.after.level);
        }
      }),
      { numRuns: 60 },
    );
  });
});
