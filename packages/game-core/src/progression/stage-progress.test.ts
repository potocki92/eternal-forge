import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CombatOutcome } from '../combat/index.js';
import { GameCoreError } from '../errors.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { STAGE_NUMBER_MAX, StageNumber } from '../stage/index.js';
import {
  INITIAL_STAGE_MODE,
  INITIAL_STAGE_PROGRESS,
  STAGE_MODES,
  advanceStageProgress,
  createStageProgress,
  selectStage,
  type StageMode,
  type StageProgress,
  type StageSelection,
} from './stage-progress.js';

const rules = getGameRules(GAME_RULES_VERSION).progression;

/** `current / highestReached / highestCleared`, with `null` for "none cleared". */
function progress(current: number, reached: number, cleared: number | null): StageProgress {
  return {
    current: StageNumber.of(current),
    highestReached: StageNumber.of(reached),
    highestCleared: cleared === null ? null : StageNumber.of(cleared),
  };
}

function view(value: StageProgress): string {
  return `${value.current.toString()} / ${value.highestReached.toString()} / ${value.highestCleared?.toString() ?? 'null'}`;
}

describe('StageProgress — the ADR-020 transition matrix', () => {
  it('a new character is on stage 1, has reached it and cleared nothing', () => {
    expect(view(INITIAL_STAGE_PROGRESS)).toBe('1 / 1 / null');
  });

  it.each<[string, StageProgress, CombatOutcome, string]>([
    ['first victory', progress(1, 1, null), 'WIN', '2 / 2 / 1'],
    ['normal progression', progress(8, 8, 7), 'WIN', '9 / 9 / 8'],
    ['reaching the boss', progress(9, 9, 8), 'WIN', '10 / 10 / 9'],
    ['boss defeat keeps the record', progress(10, 10, 9), 'LOSS', '9 / 10 / 9'],
    ['boss victory', progress(10, 10, 9), 'WIN', '11 / 11 / 10'],
    ['farming a cleared stage moves on to the wall', progress(9, 10, 9), 'WIN', '10 / 10 / 9'],
    ['losing while farming falls back further', progress(9, 10, 9), 'LOSS', '8 / 10 / 9'],
    ['a defeat on stage 1 stays on stage 1', progress(1, 1, null), 'LOSS', '1 / 1 / null'],
  ])('%s: %s', (_label, before, outcome, after) => {
    expect(view(advanceStageProgress(before, outcome, 'PROGRESS', rules))).toBe(after);
  });

  it('a normal-stage defeat follows the same fallback rule as a boss defeat', () => {
    // Uniform by design (docs/GAME_DESIGN.md): no Phase 3 path leaves a hero
    // stuck on a stage it cannot beat.
    expect(view(advanceStageProgress(progress(23, 23, 22), 'LOSS', 'PROGRESS', rules))).toBe(
      '22 / 23 / 22',
    );
  });

  it('follows the rule set: a zero fallback retries the same stage', () => {
    const retry = { ...rules, stagesLostOnDefeat: 0 };
    expect(view(advanceStageProgress(progress(10, 10, 9), 'LOSS', 'PROGRESS', retry))).toBe(
      '10 / 10 / 9',
    );
  });

  it('is exact beyond 2^53', () => {
    const deep = progress(1, 1, null);
    const big = {
      current: StageNumber.of(2n ** 53n + 1n),
      highestReached: StageNumber.of(2n ** 53n + 1n),
      highestCleared: StageNumber.of(2n ** 53n),
    };
    expect(view(advanceStageProgress(big, 'WIN', 'PROGRESS', rules))).toBe(
      '9007199254740994 / 9007199254740994 / 9007199254740993',
    );
    expect(view(deep)).toBe('1 / 1 / null');
  });

  it('refuses to move past the last stage', () => {
    const top = {
      current: StageNumber.of(STAGE_NUMBER_MAX),
      highestReached: StageNumber.of(STAGE_NUMBER_MAX),
      highestCleared: null,
    };
    expect(() => advanceStageProgress(top, 'WIN', 'PROGRESS', rules)).toThrow(
      expect.objectContaining({ code: 'OUT_OF_RANGE' }),
    );
  });
});

describe('createStageProgress — invariants', () => {
  it.each([
    ['current beyond the highest reached', progress(1, 1, null), { current: StageNumber.of(2) }],
    [
      'cleared beyond the highest reached',
      progress(3, 3, 2),
      { highestCleared: StageNumber.of(4) },
    ],
  ])('rejects %s', (_label, base, change) => {
    expect(() => createStageProgress({ ...base, ...change })).toThrow(GameCoreError);
    expect(() => advanceStageProgress({ ...base, ...change }, 'WIN', 'PROGRESS', rules)).toThrow(
      GameCoreError,
    );
  });

  it('allows farming below the highest stage reached — future stage selection needs it', () => {
    expect(view(createStageProgress(progress(3, 97, 96)))).toBe('3 / 97 / 96');
  });
});

describe('StageProgress — properties', () => {
  const validProgress = fc
    .record({
      reached: fc.bigInt({ min: 1n, max: 10n ** 15n }),
      currentOffset: fc.bigInt({ min: 0n, max: 10n ** 15n }),
      clearedOffset: fc.option(fc.bigInt({ min: 0n, max: 10n ** 15n }), { nil: null }),
    })
    .map(({ reached, currentOffset, clearedOffset }) => ({
      current: StageNumber.of(reached - (currentOffset % reached)),
      highestReached: StageNumber.of(reached),
      highestCleared:
        clearedOffset === null || clearedOffset >= reached
          ? null
          : StageNumber.of(reached - clearedOffset),
    }));
  const outcomes = fc.array(
    fc.tuple(
      fc.constantFrom<CombatOutcome>('WIN', 'LOSS'),
      fc.constantFrom<StageMode>(...STAGE_MODES),
    ),
    { minLength: 1, maxLength: 60 },
  );

  it('keeps the invariants and never lowers a record, over any sequence of combats and modes', () => {
    fc.assert(
      fc.property(validProgress, outcomes, (start, sequence) => {
        let state = start;
        for (const [outcome, mode] of sequence) {
          const next = advanceStageProgress(state, outcome, mode, rules);

          // Invariants.
          expect(next.current.compare(next.highestReached)).toBeLessThanOrEqual(0);
          if (next.highestCleared !== null) {
            expect(next.highestCleared.compare(next.highestReached)).toBeLessThanOrEqual(0);
          }
          // Monotonic records.
          expect(next.highestReached.compare(state.highestReached)).toBeGreaterThanOrEqual(0);
          if (state.highestCleared !== null) {
            expect(next.highestCleared?.compare(state.highestCleared)).toBeGreaterThanOrEqual(0);
          }

          if (mode === 'FARM') {
            // Farming never moves the hero, whatever the outcome.
            expect(next.current).toBe(state.current);
          }
          if (outcome === 'LOSS') {
            // A defeat clears nothing and unlocks nothing.
            expect(next.highestCleared).toBe(state.highestCleared);
            expect(next.highestReached).toBe(state.highestReached);
          } else {
            // A victory clears at most the stage actually fought.
            expect(next.highestCleared?.compare(state.current)).toBeGreaterThanOrEqual(0);
            if (state.highestCleared === null || state.highestCleared.compare(state.current) < 0) {
              expect(next.highestCleared?.equals(state.current)).toBe(true);
            } else {
              expect(next.highestCleared).toBe(state.highestCleared);
            }
          }
          state = next;
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('advanceStageProgress — FARM (ADR-021)', () => {
  it.each<[string, StageProgress, CombatOutcome, string]>([
    ['a farm win stays on the stage', progress(99, 100, 99), 'WIN', '99 / 100 / 99'],
    ['a farm loss stays on the stage', progress(99, 100, 99), 'LOSS', '99 / 100 / 99'],
    ['farming an early stage keeps every record', progress(3, 100, 99), 'WIN', '3 / 100 / 99'],
    // A victory is a victory: winning an uncleared stage while farming it
    // clears it, exactly as it would while climbing. Nothing else moves.
    ['a farm win on an uncleared stage proves it', progress(7, 7, null), 'WIN', '7 / 8 / 7'],
    ['a farm win on the frontier boss clears it', progress(10, 10, 9), 'WIN', '10 / 11 / 10'],
    ['a farm loss on the frontier boss retries it', progress(10, 10, 9), 'LOSS', '10 / 10 / 9'],
  ])('%s: %s', (_label, before, outcome, after) => {
    expect(view(advanceStageProgress(before, outcome, 'FARM', rules))).toBe(after);
  });

  it('500 farm wins below an unbeaten boss never clear the boss', () => {
    // highestReached = 100 (the boss), highestCleared = 99: farming stage 99.
    let state = progress(99, 100, 99);
    for (let fight = 0; fight < 500; fight += 1) {
      state = advanceStageProgress(state, 'WIN', 'FARM', rules);
    }
    expect(view(state)).toBe('99 / 100 / 99');
  });

  it('farms exactly beyond 2^53', () => {
    const deep = {
      current: StageNumber.of(9_007_199_254_740_993n),
      highestReached: StageNumber.of(9_007_199_254_740_995n),
      highestCleared: StageNumber.of(9_007_199_254_740_994n),
    };
    expect(view(advanceStageProgress(deep, 'WIN', 'FARM', rules))).toBe(
      '9007199254740993 / 9007199254740995 / 9007199254740994',
    );
  });

  it('keeps the PROGRESS transition of ADR-020 untouched', () => {
    expect(view(advanceStageProgress(progress(9, 10, 9), 'WIN', 'PROGRESS', rules))).toBe(
      '10 / 10 / 9',
    );
    expect(view(advanceStageProgress(progress(10, 10, 9), 'LOSS', 'PROGRESS', rules))).toBe(
      '9 / 10 / 9',
    );
  });
});

describe('selectStage (ADR-021)', () => {
  const farm = (stage: bigint | number): StageSelection => ({
    mode: 'FARM',
    stage: StageNumber.of(stage),
  });

  it('a new character climbs', () => {
    expect(INITIAL_STAGE_MODE).toBe('PROGRESS');
    expect(STAGE_MODES).toEqual(['PROGRESS', 'FARM']);
  });

  it.each<[string, StageProgress, StageSelection, string]>([
    ['farm an earlier stage', progress(9, 10, 9), farm(3), '3 / 10 / 9'],
    ['farm the highest stage cleared', progress(10, 10, 9), farm(9), '9 / 10 / 9'],
    ['farm the frontier itself', progress(3, 10, 9), farm(10), '10 / 10 / 9'],
    ['farm stage 1', progress(5, 5, 4), farm(1), '1 / 5 / 4'],
    ['climb returns to the frontier', progress(3, 10, 9), { mode: 'PROGRESS' }, '10 / 10 / 9'],
    ['climb after a boss defeat', progress(9, 10, 9), { mode: 'PROGRESS' }, '10 / 10 / 9'],
    ['climb before any clear', progress(1, 1, null), { mode: 'PROGRESS' }, '1 / 1 / null'],
  ])('%s: %s', (_label, before, selection, after) => {
    expect(view(selectStage(before, selection))).toBe(after);
  });

  it.each([
    ['one stage beyond the frontier', progress(9, 10, 9), 11n],
    ['an absurd stage', progress(9, 10, 9), 999_999n],
    ['the last stage number', progress(1, 1, null), STAGE_NUMBER_MAX],
  ])('refuses %s with STAGE_LOCKED', (_label, before, stage) => {
    expect(() => selectStage(before, farm(stage))).toThrow(
      expect.objectContaining({ code: 'STAGE_LOCKED' }),
    );
  });

  it('never moves a record', () => {
    const before = progress(50, 100, 99);
    for (const selection of [farm(1), farm(100), { mode: 'PROGRESS' } as const]) {
      const after = selectStage(before, selection);
      expect(after.highestReached).toBe(before.highestReached);
      expect(after.highestCleared).toBe(before.highestCleared);
    }
  });

  it('selects exactly beyond 2^53: 9007199254740993 is not rounded', () => {
    const deep = {
      current: StageNumber.of(1),
      highestReached: StageNumber.of(9_007_199_254_740_995n),
      highestCleared: StageNumber.of(9_007_199_254_740_994n),
    };
    expect(selectStage(deep, farm(9_007_199_254_740_993n)).current.toString()).toBe(
      '9007199254740993',
    );
    // As doubles, 2^53 + 3 (the frontier) and 2^53 + 4 are the same number,
    // so a float comparison would unlock 2^53 + 4. It must stay locked.
    expect(() => selectStage(deep, farm(9_007_199_254_740_996n))).toThrow(
      expect.objectContaining({ code: 'STAGE_LOCKED' }),
    );
  });

  it('rejects progress that breaks its invariants', () => {
    const broken = { ...progress(1, 1, null), current: StageNumber.of(2) };
    expect(() => selectStage(broken, { mode: 'PROGRESS' })).toThrow(GameCoreError);
  });

  it('a selection is idempotent', () => {
    const once = selectStage(progress(9, 10, 9), farm(4));
    expect(selectStage(once, farm(4))).toEqual(once);
  });
});
