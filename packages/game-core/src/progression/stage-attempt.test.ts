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
import {
  describeProgress,
  resolveStageAttempt,
  stageAfterCombat,
  type CharacterProgress,
} from './stage-attempt.js';

const rules = getGameRules(GAME_RULES_VERSION);
const n = (value: number | string): HugeNumber =>
  typeof value === 'number' ? HugeNumber.fromNumber(value) : HugeNumber.fromDecimal(value);

function progress(overrides: Partial<CharacterProgress> = {}): CharacterProgress {
  return {
    level: 1,
    experience: HugeNumber.ZERO,
    gold: HugeNumber.ZERO,
    stage: StageNumber.FIRST,
    ...overrides,
  };
}

function attempt(overrides: Partial<CharacterProgress> = {}, seed = 'attempt') {
  return resolveStageAttempt({
    progress: progress(overrides),
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
    expect(result.after.stage.toString()).toBe('2');
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
  const result = attempt({ stage: StageNumber.of(10), gold: n(50), experience: n(9) });

  it('grants nothing and changes neither level, experience nor gold', () => {
    expect(result.combat.outcome).toBe('LOSS');
    expect(result.rewards).toEqual(NO_REWARDS);
    expect(result.levelsGained).toBe(0);
    expect(result.after.level).toBe(1);
    expect(result.after.experience.eq(n(9))).toBe(true);
    expect(result.after.gold.eq(n(50))).toBe(true);
  });

  it('falls back stagesLostOnDefeat stages, so the wall becomes a farm', () => {
    expect(rules.progression.stagesLostOnDefeat).toBe(1);
    expect(result.after.stage.toString()).toBe('9');
  });
});

describe('resolveStageAttempt — bosses', () => {
  it('classifies boss stages from the rule set, not from the caller', () => {
    const boss = attempt({ level: 60, stage: StageNumber.of(20) });
    expect(boss.stage.kind).toBe('BOSS');
    expect(boss.enemy.archetypeId).toBe(rules.stages.bossArchetype.id);

    const regular = attempt({ level: 60, stage: StageNumber.of(21) });
    expect(regular.stage.kind).toBe('REGULAR');
    expect(regular.enemy.archetypeId).toBe(rules.stages.regularArchetype.id);
  });

  it('pays the boss multiplier on a boss win', () => {
    const boss = attempt({ level: 60, stage: StageNumber.of(20) });
    expect(boss.combat.outcome).toBe('WIN');
    const regular = calculateStageRewards(
      { number: StageNumber.of(20), kind: 'REGULAR' },
      rules.rewards,
    );
    expect(boss.rewards.gold.eq(regular.gold.mul(rules.rewards.bossRewardMultiplier).floor())).toBe(
      true,
    );
    expect(boss.after.stage.toString()).toBe('21');
  });
});

describe('stageAfterCombat', () => {
  it('advances one stage after a win', () => {
    expect(stageAfterCombat(StageNumber.of(9), 'WIN', rules.progression).toString()).toBe('10');
  });

  it('never falls back before stage 1', () => {
    expect(stageAfterCombat(StageNumber.FIRST, 'LOSS', rules.progression)).toBe(StageNumber.FIRST);
    expect(
      stageAfterCombat(StageNumber.of(3), 'LOSS', { ...rules.progression, stagesLostOnDefeat: 5 }),
    ).toBe(StageNumber.FIRST);
  });

  it('keeps the stage after a loss when the rule set says so', () => {
    expect(
      stageAfterCombat(StageNumber.of(7), 'LOSS', {
        ...rules.progression,
        stagesLostOnDefeat: 0,
      }).toString(),
    ).toBe('7');
  });

  it('is exact beyond 2^53', () => {
    const deep = StageNumber.of(2n ** 53n + 1n);
    expect(stageAfterCombat(deep, 'WIN', rules.progression).toString()).toBe('9007199254740994');
    expect(stageAfterCombat(deep, 'LOSS', rules.progression).toString()).toBe('9007199254740992');
  });

  it('refuses to advance past the last stage', () => {
    expect(() =>
      stageAfterCombat(StageNumber.of(STAGE_NUMBER_MAX), 'WIN', rules.progression),
    ).toThrow(expect.objectContaining({ code: 'OUT_OF_RANGE' }));
  });
});

describe('resolveStageAttempt — determinism', () => {
  it('same progress + seed + rules version produces an identical result', () => {
    const input = { level: 12, stage: StageNumber.of(13), gold: n(777), experience: n(5) };
    const first = attempt(input, 'replay');
    const second = attempt(input, 'replay');
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('the seed decides the rolls: different seeds can produce different combats', () => {
    const combats = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) =>
        JSON.stringify(attempt({ level: 20, stage: StageNumber.of(21) }, seed).combat.events),
      ),
    );
    expect(combats.size).toBeGreaterThan(1);
  });
});

describe('resolveStageAttempt — validation and limits', () => {
  it.each([
    ['negative gold', { gold: n(-1) }],
    ['fractional gold', { gold: n('0.5') }],
    ['negative experience', { experience: n(-3) }],
    ['level 0', { level: 0 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => attempt(overrides)).toThrow(GameCoreError);
  });

  it('rejects an unsupported rules version', () => {
    expect(() =>
      resolveStageAttempt({ progress: progress(), seed: 'x', rulesVersion: 999 }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_RULES_VERSION' }));
  });

  it('reports a stage too deep for the rule set as OVERFLOW, never a wrong value', () => {
    expect(() => attempt({ stage: StageNumber.of(10n ** 12n) })).toThrow(
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
          stage: StageNumber.of(stage),
          gold: HugeNumber.fromBigInt(gold),
          experience: required.mul(n(experienceFraction)).div(n(100)).floor(),
        });
        const result = resolveStageAttempt({ progress: before, seed, rulesVersion: 1 });
        const { after } = result;

        if (result.combat.outcome === 'WIN') {
          expect(after.stage.equals(before.stage.next())).toBe(true);
          expect(after.gold.eq(before.gold.add(result.rewards.gold))).toBe(true);
          expect(after.level).toBe(before.level + result.levelsGained);
        } else {
          expect(result.rewards).toEqual(NO_REWARDS);
          expect(after.stage.equals(before.stage.stepBack(1))).toBe(true);
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

describe('describeProgress', () => {
  it('derives the experience requirement, stats and upcoming encounter', () => {
    const description = describeProgress(progress({ level: 3, stage: StageNumber.of(10) }), 1);
    expect(description.experienceToNextLevel.eq(n(12))).toBe(true);
    expect(description.character).toEqual(createCharacter(3, rules));
    expect(description.encounter.stage.kind).toBe('BOSS');
    expect(description.encounter).toEqual(createEnemyForStage(StageNumber.of(10), rules));
  });
});
