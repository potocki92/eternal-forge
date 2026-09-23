import { GameCoreError } from '../errors.js';
import type { CombatOutcome } from '../combat/index.js';
import type { ProgressionRules } from '../rules/index.js';
import { StageNumber } from '../stage/index.js';

/**
 * Where a character stands on the stage ladder (ADR-020).
 *
 * One stage number used to mean both "where the hero fights next" and "how far
 * the hero has come". A boss defeat that sent the hero back to farm therefore
 * erased the record. The two meanings are now separate values:
 *
 * - `current`: the stage the next combat is fought on — the stage being
 *   pushed or farmed.
 * - `highestReached`: the highest stage ever unlocked. It never decreases.
 * - `highestCleared`: the highest stage ever defeated, or `null` when no stage
 *   has been cleared yet. It never decreases. This is the value progression
 *   rankings use: farming an earlier stage never lowers it.
 *
 * Invariants, enforced by {@link createStageProgress} and by the database:
 * `current ≤ highestReached` and `highestCleared ≤ highestReached` (when not
 * `null`). All three are exact {@link StageNumber}s; there is no "stage 0".
 */
export interface StageProgress {
  readonly current: StageNumber;
  readonly highestReached: StageNumber;
  readonly highestCleared: StageNumber | null;
}

/** A new character: on stage 1, which it has reached but not cleared. */
export const INITIAL_STAGE_PROGRESS: StageProgress = Object.freeze({
  current: StageNumber.FIRST,
  highestReached: StageNumber.FIRST,
  highestCleared: null,
});

/**
 * Validates the invariants and returns the progress unchanged. Stored state
 * that breaks them is rejected, never repaired.
 *
 * @throws {GameCoreError} `INVALID_ARGUMENT`.
 */
export function createStageProgress(progress: StageProgress): StageProgress {
  if (progress.current.compare(progress.highestReached) > 0) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      'The current stage cannot be beyond the highest stage reached.',
    );
  }
  if (
    progress.highestCleared !== null &&
    progress.highestCleared.compare(progress.highestReached) > 0
  ) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      'The highest stage cleared cannot be beyond the highest stage reached.',
    );
  }
  return progress;
}

/**
 * The stage progress after a combat on `progress.current` (ADR-020).
 *
 * - **Win:** the stage fought is cleared, which raises `highestCleared` if it
 *   is a new record, and unlocks the next stage, which raises
 *   `highestReached` if needed. The hero moves on to the next stage — Phase 3
 *   always pushes forward; a "stay and farm" choice is FUTURE.
 * - **Loss:** nothing is cleared or unlocked. The hero falls back
 *   `stagesLostOnDefeat` stages to farm, never below stage 1. The records are
 *   untouched, so a lost boss fight never erases how far the hero came.
 *
 * `highestReached` and `highestCleared` never decrease.
 */
export function advanceStageProgress(
  progress: StageProgress,
  outcome: CombatOutcome,
  rules: ProgressionRules,
): StageProgress {
  const before = createStageProgress(progress);
  const fought = before.current;

  if (outcome === 'LOSS') {
    return { ...before, current: fought.stepBack(rules.stagesLostOnDefeat) };
  }

  const next = fought.next();
  return {
    current: next,
    highestReached: maxStage(before.highestReached, next),
    highestCleared:
      before.highestCleared === null ? fought : maxStage(before.highestCleared, fought),
  };
}

function maxStage(first: StageNumber, second: StageNumber): StageNumber {
  return first.compare(second) >= 0 ? first : second;
}
