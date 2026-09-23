import { StageNumber, createStageProgress, type StageProgress } from '@eternal-forge/game-core';

/**
 * The three stage-progress columns of `characters` (ADR-020). Declared here so
 * both repositories map them the same way.
 */
export interface StageProgressColumns {
  readonly currentStage: bigint;
  readonly highestStageReached: bigint;
  readonly highestStageCleared: bigint | null;
}

/**
 * bigint to bigint: exact. A value outside 1…2^63 − 1, or a row that breaks
 * the invariants, cannot pass the column types and CHECKs; if one ever did,
 * this throws instead of repairing it.
 */
export function toStageProgress(columns: StageProgressColumns): StageProgress {
  return createStageProgress({
    current: StageNumber.of(columns.currentStage),
    highestReached: StageNumber.of(columns.highestStageReached),
    highestCleared:
      columns.highestStageCleared === null ? null : StageNumber.of(columns.highestStageCleared),
  });
}

export function toStageProgressColumns(stages: StageProgress): StageProgressColumns {
  return {
    currentStage: stages.current.toBigInt(),
    highestStageReached: stages.highestReached.toBigInt(),
    highestStageCleared: stages.highestCleared?.toBigInt() ?? null,
  };
}
