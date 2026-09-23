import type {
  CharacterProgress,
  CombatEndReason,
  CombatOutcome,
  StageAttemptResult,
  StageRewards,
} from '@eternal-forge/game-core';

/**
 * The persisted record of one resolved combat (ADR-019).
 *
 * It holds the replay inputs — rules version, server seed and the progress the
 * character fought with — and the audited summary of the result. The event log
 * is not part of it: Game Core regenerates it from the inputs.
 */
export interface CombatRunRecord {
  readonly characterId: string;
  readonly idempotencyKey: string;
  readonly rulesVersion: number;
  readonly seed: string;
  /** Progress before the combat: level, experience, gold and the stage fought. */
  readonly before: CharacterProgress;
  readonly outcome: CombatOutcome;
  readonly endReason: CombatEndReason;
  readonly durationMs: number;
  readonly rewards: StageRewards;
  /** Server time the combat was resolved. */
  readonly resolvedAt: Date;
}

export interface CombatRun extends CombatRunRecord {
  readonly id: string;
}

/** The record of `attempt`, exactly as Game Core produced it. */
export function recordAttempt(
  attempt: StageAttemptResult,
  context: {
    readonly characterId: string;
    readonly idempotencyKey: string;
    readonly resolvedAt: Date;
  },
): CombatRunRecord {
  return {
    ...context,
    rulesVersion: attempt.rulesVersion,
    seed: attempt.seed,
    before: attempt.before,
    outcome: attempt.combat.outcome,
    endReason: attempt.combat.endReason,
    durationMs: attempt.combat.durationMs,
    rewards: attempt.rewards,
  };
}

/**
 * Whether re-running a stored combat reproduced its recorded summary. Anything
 * else means determinism was broken: a defect, never a reason to serve a
 * different result.
 */
export function replayMatches(run: CombatRun, attempt: StageAttemptResult): boolean {
  return (
    attempt.rulesVersion === run.rulesVersion &&
    attempt.stage.number.equals(run.before.stage) &&
    attempt.combat.outcome === run.outcome &&
    attempt.combat.endReason === run.endReason &&
    attempt.combat.durationMs === run.durationMs &&
    attempt.rewards.gold.eq(run.rewards.gold) &&
    attempt.rewards.experience.eq(run.rewards.experience)
  );
}
