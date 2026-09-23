import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../character/character.js';
import { simulateCombat } from '../combat/index.js';
import { createEnemyForStage } from '../enemy/enemy.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { NO_REWARDS, calculateStageRewards } from '../rewards/rewards.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { STAGE_NUMBER_MAX, StageNumber } from '../stage/index.js';
import { experienceToNextLevel } from './level.js';
import { INITIAL_STAGE_PROGRESS, type StageMode, type StageProgress } from './stage-progress.js';
import { describeProgress, resolveStageAttempt, type CharacterProgress } from './stage-attempt.js';

const rules = getGameRules(GAME_RULES_VERSION);
const n = (value: number | string): HugeNumber =>
  typeof value === 'number' ? HugeNumber.fromNumber(value) : HugeNumber.fromDecimal(value);

function progress(overrides: Partial<CharacterProgress> = {}): CharacterProgress {
  return {
    level: 1,
    experience: HugeNumber.ZERO,
    gold: HugeNumber.ZERO,
    stages: INITIAL_STAGE_PROGRESS,
    ...overrides,
  };
}

/** A hero pushing its record: on `stage`, having cleared every stage before it. */
function pushingAt(stage: bigint | number): StageProgress {
  const current = StageNumber.of(stage);
  return {
    current,
    highestReached: current,
    highestCleared: current.equals(StageNumber.FIRST) ? null : current.stepBack(1),
  };
}

function attempt(
  overrides: Partial<CharacterProgress> = {},
  seed = 'attempt',
  mode: StageMode = 'PROGRESS',
) {
  return resolveStageAttempt({
    progress: progress(overrides),
    mode,
    seed,
    rulesVersion: GAME_RULES_VERSION,
  });
}

describe('resolveStageAttempt — a win', () => {
  const result = attempt({ gold: n(100), experience: n(2) });

  it('fights the rule set’s enemy for the current stage with level-derived stats', () => {
    expect(result.stage.number.equals(StageNumber.FIRST)).toBe(true);
    expect(result.enemy).toEqual(createEnemyForStage(StageNumber.FIRST, rules));
    expect(result.character).toEqual(createCharacter(1, rules));
    expect(result.combat).toEqual(
      simulateCombat({
        player: createCharacter(1, rules),
        enemy: createEnemyForStage(StageNumber.FIRST, rules),
        seed: 'attempt',
        rulesVersion: GAME_RULES_VERSION,
      }),
    );
  });

  it('grants the stage rewards and advances exactly one stage', () => {
    expect(result.combat.outcome).toBe('WIN');
    const expected = calculateStageRewards(result.stage, rules.rewards);
    expect(result.rewards).toEqual(expected);
    expect(result.after.gold.eq(n(100).add(expected.gold))).toBe(true);
    expect(result.after.experience.eq(n(2).add(expected.experience))).toBe(true);
    expect(result.after.stages.current.toString()).toBe('2');
    expect(result.after.stages.highestReached.toString()).toBe('2');
    expect(result.after.stages.highestCleared?.toString()).toBe('1');
    expect(result.levelsGained).toBe(0);
  });

  it('reports the progress it started from unchanged', () => {
    expect(result.before).toEqual(progress({ gold: n(100), experience: n(2) }));
    expect(result.rulesVersion).toBe(GAME_RULES_VERSION);
    expect(result.seed).toBe('attempt');
  });

  it('levels up when the reward crosses the requirement', () => {
    // Stage 1 pays 3 experience; 8 + 3 = 11 ≥ 10.
    const leveled = attempt({ experience: n(8) });
    expect(leveled.levelsGained).toBe(1);
    expect(leveled.after.level).toBe(2);
    expect(leveled.after.experience.eq(n(1))).toBe(true);
  });
});

describe('resolveStageAttempt — a loss', () => {
  // A level-1 hero cannot beat the stage-10 boss under rules v1.
  const result = attempt({ stages: pushingAt(10), gold: n(50), experience: n(9) });

  it('keeps the historical records: stage 10 stays reached, stage 9 stays cleared', () => {
    expect(result.stage.number.toString()).toBe('10');
    expect(result.after.stages.highestReached.toString()).toBe('10');
    expect(result.after.stages.highestCleared?.toString()).toBe('9');
  });

  it('grants nothing and changes neither level, experience nor gold', () => {
    expect(result.combat.outcome).toBe('LOSS');
    expect(result.rewards).toEqual(NO_REWARDS);
    expect(result.levelsGained).toBe(0);
    expect(result.after.level).toBe(1);
    expect(result.after.experience.eq(n(9))).toBe(true);
    expect(result.after.gold.eq(n(50))).toBe(true);
  });

  it('never levels up on a loss, even with experience banked by a capped gain', () => {
    // Regression: a gain capped at MAX_LEVELS_PER_GAIN leaves experience at or
    // above the requirement. A defeat must not consume it.
    const banked = experienceToNextLevel(1, rules.progression).mul(n(5));
    const lost = attempt({ stages: pushingAt(10), experience: banked });

    expect(lost.combat.outcome).toBe('LOSS');
    expect(lost.levelsGained).toBe(0);
    expect(lost.after.level).toBe(1);
    expect(lost.after.experience.eq(banked)).toBe(true);
  });

  it('falls back stagesLostOnDefeat stages, so the wall becomes a farm', () => {
    expect(rules.progression.stagesLostOnDefeat).toBe(1);
    expect(result.after.stages.current.toString()).toBe('9');
  });
});

describe('resolveStageAttempt — bosses', () => {
  it('classifies boss stages from the rule set, not from the caller', () => {
    const boss = attempt({ level: 60, stages: pushingAt(20) });
    expect(boss.stage.kind).toBe('BOSS');
    expect(boss.enemy.archetypeId).toBe(rules.stages.bossArchetype.id);

    const regular = attempt({ level: 60, stages: pushingAt(21) });
    expect(regular.stage.kind).toBe('REGULAR');
    expect(regular.enemy.archetypeId).toBe(rules.stages.regularArchetype.id);
  });

  it('pays the boss multiplier on a boss win', () => {
    const boss = attempt({ level: 60, stages: pushingAt(20) });
    expect(boss.combat.outcome).toBe('WIN');
    const regular = calculateStageRewards(
      { number: StageNumber.of(20), kind: 'REGULAR' },
      rules.rewards,
    );
    expect(boss.rewards.gold.eq(regular.gold.mul(rules.rewards.bossRewardMultiplier).floor())).toBe(
      true,
    );
    expect(boss.after.stages.current.toString()).toBe('21');
  });
});

describe('resolveStageAttempt — determinism', () => {
  it('same progress + seed + rules version produces an identical result', () => {
    const input = { level: 12, stages: pushingAt(13), gold: n(777), experience: n(5) };
    const first = attempt(input, 'replay');
    const second = attempt(input, 'replay');
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('the seed decides the rolls: different seeds can produce different combats', () => {
    const combats = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) =>
        JSON.stringify(attempt({ level: 20, stages: pushingAt(21) }, seed).combat.events),
      ),
    );
    expect(combats.size).toBeGreaterThan(1);
  });
});

describe('resolveStageAttempt — validation and limits', () => {
  it.each([
    [
      'stage progress that breaks its invariants',
      {
        stages: {
          current: StageNumber.of(5),
          highestReached: StageNumber.of(4),
          highestCleared: StageNumber.of(3),
        },
      },
    ],
    ['negative gold', { gold: n(-1) }],
    ['fractional gold', { gold: n('0.5') }],
    ['negative experience', { experience: n(-3) }],
    ['level 0', { level: 0 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => attempt(overrides)).toThrow(GameCoreError);
  });

  it('rejects an unsupported rules version', () => {
    expect(() =>
      resolveStageAttempt({ progress: progress(), mode: 'PROGRESS', seed: 'x', rulesVersion: 999 }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_RULES_VERSION' }));
  });

  it('reports a stage too deep for the rule set as OVERFLOW, never a wrong value', () => {
    expect(() => attempt({ stages: pushingAt(10n ** 12n) })).toThrow(
      expect.objectContaining({ code: 'OVERFLOW' }),
    );
  });

  it('carries gold beyond 10^18 with HugeNumber precision', () => {
    const rich = attempt({ gold: n('1e30') });
    expect(rich.after.gold.gte(n('1e30'))).toBe(true);
  });
});

describe('resolveStageAttempt — invariants (property)', () => {
  const inputs = fc.record({
    level: fc.integer({ min: 1, max: 400 }),
    stage: fc.bigInt({ min: 1n, max: 400n }),
    gold: fc.bigInt({ min: 0n, max: 10n ** 24n }),
    experienceFraction: fc.integer({ min: 0, max: 99 }),
    seed: fc.string({ minLength: 1, maxLength: 32 }),
  });

  it('holds for any valid progress and seed', () => {
    fc.assert(
      fc.property(inputs, ({ level, stage, gold, experienceFraction, seed }) => {
        const required = experienceToNextLevel(level, rules.progression);
        const before = progress({
          level,
          stages: pushingAt(stage),
          gold: HugeNumber.fromBigInt(gold),
          experience: required.mul(n(experienceFraction)).div(n(100)).floor(),
        });
        const result = resolveStageAttempt({
          progress: before,
          mode: 'PROGRESS',
          seed,
          rulesVersion: 1,
        });
        const { after } = result;

        // The stage fought is always the current one, and the records only move up.
        expect(result.stage.number.equals(before.stages.current)).toBe(true);
        expect(
          after.stages.highestReached.compare(before.stages.highestReached),
        ).toBeGreaterThanOrEqual(0);
        if (result.combat.outcome === 'WIN') {
          expect(after.stages.current.equals(before.stages.current.next())).toBe(true);
          expect(after.stages.highestCleared?.equals(before.stages.current)).toBe(true);
          expect(after.gold.eq(before.gold.add(result.rewards.gold))).toBe(true);
          expect(after.level).toBe(before.level + result.levelsGained);
        } else {
          expect(result.rewards).toEqual(NO_REWARDS);
          expect(after.stages.current.equals(before.stages.current.stepBack(1))).toBe(true);
          expect(after.stages.highestCleared).toBe(before.stages.highestCleared);
          expect(after.stages.highestReached).toBe(before.stages.highestReached);
          expect(after.gold.eq(before.gold)).toBe(true);
          expect(after.level).toBe(before.level);
          expect(after.experience.eq(before.experience)).toBe(true);
        }
        // Experience within a level stays below that level's requirement.
        expect(after.experience.lt(experienceToNextLevel(after.level, rules.progression))).toBe(
          true,
        );
        expect(after.experience.isInteger() && !after.experience.isNegative()).toBe(true);
        expect(after.gold.isInteger() && !after.gold.isNegative()).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('resolveStageAttempt — FARM mode (ADR-021)', () => {
  /** Farming stage 99 below an unbeaten stage-100 boss. */
  const belowBoss: StageProgress = {
    current: StageNumber.of(99),
    highestReached: StageNumber.of(100),
    highestCleared: StageNumber.of(99),
  };
  const strong = { level: 400, stages: belowBoss, gold: n(10), experience: n(0) };

  it('fights the same enemy with the same combat and rewards as climbing', () => {
    const farmed = attempt(strong, 'farm-seed', 'FARM');
    const climbed = attempt(strong, 'farm-seed', 'PROGRESS');

    expect(farmed.combat.outcome).toBe('WIN');
    expect(farmed.enemy).toEqual(climbed.enemy);
    expect(farmed.combat).toEqual(climbed.combat);
    expect(farmed.rewards).toEqual(climbed.rewards);
    expect(farmed.after.gold.eq(climbed.after.gold)).toBe(true);
    expect(farmed.after.level).toBe(climbed.after.level);
    expect(farmed.after.experience.eq(climbed.after.experience)).toBe(true);
  });

  it('a farm victory pays the stage and stays on it; the boss stays unbeaten', () => {
    const farmed = attempt(strong, 'farm-seed', 'FARM');

    expect(farmed.rewards).toEqual(calculateStageRewards(farmed.stage, rules.rewards));
    expect(farmed.after.stages).toEqual(belowBoss);
    expect(attempt(strong, 'farm-seed', 'PROGRESS').after.stages.current.toString()).toBe('100');
  });

  it('a farm defeat grants nothing and stays on the stage', () => {
    const lost = attempt({ stages: pushingAt(10), gold: n(7) }, 'attempt', 'FARM');

    expect(lost.combat.outcome).toBe('LOSS');
    expect(lost.rewards).toEqual(NO_REWARDS);
    expect(lost.after.gold.eq(n(7))).toBe(true);
    expect(lost.after.stages).toEqual(pushingAt(10));
  });

  it('farming the same stage repeatedly keeps paying and keeps the records', () => {
    let state = progress(strong);
    for (let fight = 0; fight < 20; fight += 1) {
      const result = resolveStageAttempt({
        progress: state,
        mode: 'FARM',
        seed: `farm-${String(fight)}`,
        rulesVersion: GAME_RULES_VERSION,
      });
      expect(result.combat.outcome).toBe('WIN');
      expect(result.after.gold.gt(state.gold)).toBe(true);
      state = result.after;
    }
    expect(state.stages).toEqual(belowBoss);
  });
});

describe('describeProgress', () => {
  it('derives the experience requirement, stats and upcoming encounter', () => {
    const description = describeProgress(progress({ level: 3, stages: pushingAt(10) }), 1);
    expect(description.experienceToNextLevel.eq(n(12))).toBe(true);
    expect(description.character).toEqual(createCharacter(3, rules));
    expect(description.encounter?.stage.kind).toBe('BOSS');
    expect(description.encounter).toEqual(createEnemyForStage(StageNumber.of(10), rules));
  });
});

describe('describeProgress — beyond the rule set', () => {
  it('reports no encounter where enemy scaling overflows, instead of failing', () => {
    const description = describeProgress(progress({ stages: pushingAt(STAGE_NUMBER_MAX) }), 1);
    expect(description.encounter).toBeNull();
    expect(description.experienceToNextLevel.eq(n(10))).toBe(true);
  });

  it('still describes the deepest stages the rule set can scale', () => {
    expect(
      describeProgress(progress({ stages: pushingAt(4_000_000_000) }), 1).encounter,
    ).not.toBeNull();
  });
});
