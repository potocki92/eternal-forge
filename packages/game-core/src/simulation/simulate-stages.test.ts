import { describe, expect, it } from 'vitest';
import { createCharacter } from '../character/character.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { NO_REWARDS, addRewards } from '../rewards/rewards.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { STAGE_NUMBER_MAX, StageNumber } from '../stage/index.js';
import {
  MAX_STAGES_PER_SIMULATION,
  simulateStages,
  type SimulateStagesInput,
} from './simulate-stages.js';

const rules = getGameRules(GAME_RULES_VERSION);

function run(overrides: Partial<SimulateStagesInput> = {}) {
  return simulateStages({
    character: createCharacter(1, rules),
    seed: 'stages',
    rulesVersion: GAME_RULES_VERSION,
    maxStages: 1_000,
    ...overrides,
  });
}

describe('simulateStages — headless progression', () => {
  it('wins stage after stage and stops at the first loss', () => {
    const result = run();
    const outcomes = result.stages.map((entry) => entry.outcome);

    expect(outcomes.length).toBeGreaterThan(1);
    expect(outcomes.at(-1)).toBe('LOSS');
    expect(outcomes.slice(0, -1).every((outcome) => outcome === 'WIN')).toBe(true);
    expect(result.stages.map((entry) => entry.stage.number.toBigInt())).toEqual(
      outcomes.map((_, index) => BigInt(index + 1)),
    );
    expect(result.stopReason).toBe('DEFEATED');
    expect(result.highestStageCleared?.toBigInt()).toBe(BigInt(outcomes.length - 1));
  });

  it('stops at the stage limit when the character never loses', () => {
    const result = run({ character: createCharacter(60, rules), maxStages: 5 });
    expect(result.stages).toHaveLength(5);
    expect(result.stopReason).toBe('STAGE_LIMIT');
    expect(result.highestStageCleared?.toString()).toBe('5');
  });

  it('grants rewards only for wins and totals them', () => {
    const result = run();
    const lost = result.stages.at(-1);
    expect(lost?.rewards).toEqual(NO_REWARDS);
    const expected = result.stages.reduce(
      (sum, entry) => addRewards(sum, entry.rewards),
      NO_REWARDS,
    );
    expect(result.totalRewards).toEqual(expected);
    expect(result.totalRewards.gold.gt(HugeNumber.ZERO)).toBe(true);
  });

  it('a stronger character progresses at least as far', () => {
    const levels = [1, 10, 25, 50];
    const reached = levels.map(
      (level) =>
        run({ character: createCharacter(level, rules) }).highestStageCleared?.toBigInt() ?? 0n,
    );
    expect(reached).toEqual([...reached].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1)));
    expect(reached.at(-1)).toBeGreaterThan(reached[0] ?? 0n);
  });

  it('starts mid-ladder and reports no clears when the first fight is lost', () => {
    const result = run({ startStage: StageNumber.of(500) });
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.stage.number.toString()).toBe('500');
    expect(result.highestStageCleared).toBeNull();
    expect(result.totalRewards).toEqual(NO_REWARDS);
  });
});

describe('simulateStages — determinism', () => {
  it('same input + seed + rules version produces an identical run', () => {
    const first = run({ character: createCharacter(30, rules) });
    const second = run({ character: createCharacter(30, rules) });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('a stage resolves the same regardless of where the run started', () => {
    const character = createCharacter(40, rules);
    const full = run({ character, maxStages: 12 });
    const partial = run({ character, startStage: StageNumber.of(6), maxStages: 7 });
    expect(partial.stages).toEqual(full.stages.slice(5, 12));
  });
});

describe('simulateStages — validation', () => {
  it.each([0, -1, 1.5, MAX_STAGES_PER_SIMULATION + 1])('rejects maxStages %s', (maxStages) => {
    expect(() => run({ maxStages })).toThrow(GameCoreError);
  });

  it('rejects a range that runs past the last stage before fighting', () => {
    expect(() => run({ startStage: StageNumber.of(STAGE_NUMBER_MAX), maxStages: 2 })).toThrow(
      expect.objectContaining({ code: 'OUT_OF_RANGE' }),
    );
  });

  it('rejects an unsupported rules version', () => {
    expect(() => run({ rulesVersion: 42 })).toThrow(GameCoreError);
  });
});
