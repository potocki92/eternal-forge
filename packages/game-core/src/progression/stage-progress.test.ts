import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CombatOutcome } from '../combat/index.js';
import { GameCoreError } from '../errors.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { STAGE_NUMBER_MAX, StageNumber } from '../stage/index.js';
import {
  INITIAL_STAGE_PROGRESS,
  advanceStageProgress,
  createStageProgress,
  type StageProgress,
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
    expect(view(advanceStageProgress(before, outcome, rules))).toBe(after);
  });

  it('a normal-stage defeat follows the same fallback rule as a boss defeat', () => {
    // Uniform by design (docs/GAME_DESIGN.md): no Phase 3 path leaves a hero
    // stuck on a stage it cannot beat.
    expect(view(advanceStageProgress(progress(23, 23, 22), 'LOSS', rules))).toBe('22 / 23 / 22');
  });

  it('follows the rule set: a zero fallback retries the same stage', () => {
    const retry = { ...rules, stagesLostOnDefeat: 0 };
    expect(view(advanceStageProgress(progress(10, 10, 9), 'LOSS', retry))).toBe('10 / 10 / 9');
  });

  it('is exact beyond 2^53', () => {
    const deep = progress(1, 1, null);
    const big = {
      current: StageNumber.of(2n ** 53n + 1n),
      highestReached: StageNumber.of(2n ** 53n + 1n),
      highestCleared: StageNumber.of(2n ** 53n),
    };
    expect(view(advanceStageProgress(big, 'WIN', rules))).toBe(
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
    expect(() => advanceStageProgress(top, 'WIN', rules)).toThrow(
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
    expect(() => advanceStageProgress({ ...base, ...change }, 'WIN', rules)).toThrow(GameCoreError);
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
  const outcomes = fc.array(fc.constantFrom<CombatOutcome>('WIN', 'LOSS'), {
    minLength: 1,
    maxLength: 60,
  });

  it('keeps the invariants and never lowers a record, over any sequence of combats', () => {
    fc.assert(
      fc.property(validProgress, outcomes, (start, sequence) => {
        let state = start;
        for (const outcome of sequence) {
          const next = advanceStageProgress(state, outcome, rules);

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
