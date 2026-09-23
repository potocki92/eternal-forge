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
 * What the hero does with the stage after a victory (ADR-021).
 *
 * - `PROGRESS` — climb: a win moves the hero on to the next stage, a loss
 *   falls back `stagesLostOnDefeat` stages. The Phase 3 behaviour.
 * - `FARM` — stay: the hero keeps fighting the stage it was placed on,
 *   whatever the outcome. Rewards are exactly those of a `PROGRESS` fight.
 *
 * The mode never changes a record by itself: in both modes a record rises only
 * through a victory on the stage actually fought.
 */
export type StageMode = 'PROGRESS' | 'FARM';

export const STAGE_MODES: readonly StageMode[] = Object.freeze(['PROGRESS', 'FARM']);

/** A new character climbs. */
export const INITIAL_STAGE_MODE: StageMode = 'PROGRESS';

/**
 * A player's request for where to fight (ADR-021). The player picks the mode
 * and, when farming, the stage. Whether that stage is available is decided by
 * {@link selectStage}, never by the caller.
 */
export type StageSelection =
  { readonly mode: 'PROGRESS' } | { readonly mode: 'FARM'; readonly stage: StageNumber };

/**
 * The stage progress after the player's selection (ADR-021).
 *
 * - `PROGRESS` returns the hero to its frontier: `current` becomes
 *   `highestReached`, the furthest stage it has unlocked.
 * - `FARM` places the hero on the chosen stage, which must be unlocked:
 *   `1 ≤ stage ≤ highestReached`. A stage beyond that is refused with
 *   `STAGE_LOCKED`; nothing is clamped.
 *
 * Only `current` moves. The records are returned untouched, so a selection can
 * never raise or lower `highestReached` or `highestCleared`.
 *
 * @throws {GameCoreError} `STAGE_LOCKED` for a stage the hero has not reached,
 * `INVALID_ARGUMENT` for progress that breaks its invariants.
 */
export function selectStage(progress: StageProgress, selection: StageSelection): StageProgress {
  const before = createStageProgress(progress);

  if (selection.mode === 'PROGRESS') {
    return { ...before, current: before.highestReached };
  }
  if (selection.stage.compare(before.highestReached) > 0) {
    throw new GameCoreError(
      'STAGE_LOCKED',
      'Only a stage the hero has already reached can be selected.',
    );
  }
  return { ...before, current: selection.stage };
}

/**
 * The stage progress after a combat on `progress.current` (ADR-020, ADR-021).
 *
 * The records move the same way in every mode:
 *
 * - **Win:** the stage fought is cleared, which raises `highestCleared` if it
 *   is a new record, and the next stage is unlocked, which raises
 *   `highestReached` if needed.
 * - **Loss:** nothing is cleared or unlocked. The records are untouched, so a
 *   lost boss fight never erases how far the hero came.
 *
 * Where the hero fights next depends on `mode`:
 *
 * - `PROGRESS`: a win moves on to the next stage; a loss falls back
 *   `stagesLostOnDefeat` stages to farm, never below stage 1.
 * - `FARM`: the hero stays on the stage it fought, win or lose.
 *
 * `highestReached` and `highestCleared` never decrease.
 */
export function advanceStageProgress(
  progress: StageProgress,
  outcome: CombatOutcome,
  mode: StageMode,
  rules: ProgressionRules,
): StageProgress {
  const before = createStageProgress(progress);
  const fought = before.current;

  if (outcome === 'LOSS') {
    return mode === 'FARM'
      ? before
      : { ...before, current: fought.stepBack(rules.stagesLostOnDefeat) };
  }

  const next = fought.next();
  return {
    current: mode === 'FARM' ? fought : next,
    highestReached: maxStage(before.highestReached, next),
    highestCleared:
      before.highestCleared === null ? fought : maxStage(before.highestCleared, fought),
  };
}

function maxStage(first: StageNumber, second: StageNumber): StageNumber {
  return first.compare(second) >= 0 ? first : second;
}
