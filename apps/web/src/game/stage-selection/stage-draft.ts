import {
  stageNumberSchema,
  type ProgressionDto,
  type StageNumberDto,
  type StageSelectionRequest,
} from '@eternal-forge/contracts';
import { ApiError } from '@/lib/api-client';
import { formatStage } from '@/player/format-stage';

/**
 * The stage selector's draft, independent of React.
 *
 * Everything here is input handling: reading what the player typed, stepping
 * it by one and saying whether it is worth sending. The unlocked range comes
 * from the server's `highestStageReached`, and the server validates the
 * request again (ADR-021). Stages stay canonical strings and are compared as
 * `BigInt`s, never as JavaScript numbers.
 */

export type StageDraft =
  | { readonly kind: 'valid'; readonly stage: StageNumberDto }
  | { readonly kind: 'invalid'; readonly message: string };

/** Reads a typed farm stage against the unlocked range `1 … highestReached`. */
export function readStageDraft(text: string, highestReached: StageNumberDto): StageDraft {
  const parsed = stageNumberSchema.safeParse(text.trim());
  if (!parsed.success) {
    return { kind: 'invalid', message: 'Enter a whole stage number, like 12.' };
  }
  if (BigInt(parsed.data) > BigInt(highestReached)) {
    return {
      kind: 'invalid',
      message: `Your hero has not reached that stage yet. Stages 1 to ${formatStage(highestReached)} are open.`,
    };
  }
  return { kind: 'valid', stage: parsed.data };
}

/**
 * One stage up or down, kept within `1 … highestReached`. An unreadable draft
 * restarts from `fallback`, the stage the hero is on.
 */
export function stepStage(
  text: string,
  direction: 1 | -1,
  highestReached: StageNumberDto,
  fallback: StageNumberDto,
): StageNumberDto {
  const draft = readStageDraft(text, highestReached);
  const from = BigInt(draft.kind === 'valid' ? draft.stage : fallback);
  const next = from + BigInt(direction);
  const max = BigInt(highestReached);
  return (next < 1n ? 1n : next > max ? max : next).toString();
}

/** Whether sending `request` could change anything the server holds. */
export function changesSelection(
  request: StageSelectionRequest,
  progression: ProgressionDto,
): boolean {
  if (request.mode !== progression.stageMode) {
    return true;
  }
  return request.mode === 'FARM'
    ? request.stage !== progression.currentStage
    : // Climbing resumes from the frontier, e.g. after a boss defeat.
      progression.currentStage !== progression.highestStageReached;
}

/** A player-facing reading of a failed selection. */
export function describeSelectionFailure(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Try again.';
  }
  if (error.status === undefined) {
    return 'Connection lost. Your choice was not saved — try again.';
  }
  // The API writes these two for players, with the unlocked range.
  if (error.code === 'STAGE_LOCKED' || error.code === 'CONCURRENT_UPDATE') {
    return error.message;
  }
  if (error.status === 401) {
    return 'Your session has ended.';
  }
  if (error.status === 404) {
    return 'Your hero could not be found.';
  }
  return 'The forge is unreachable right now. Try again in a moment.';
}
