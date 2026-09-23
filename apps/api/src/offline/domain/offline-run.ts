import {
  getGameRules,
  resolveOfflineProgress,
  type CharacterProgress,
  type OfflineProgressResult,
  type StageNumber,
  type StageRewards,
} from '@eternal-forge/game-core';

/**
 * The persisted record of one offline claim that fought (ADR-023).
 *
 * It holds the replay inputs — rules version, server seed, the progress at the
 * claim and the idle time on the server clock — and the audited summary of all
 * its fights. The fights themselves are not stored: Game Core regenerates each
 * one from the inputs.
 */
export interface OfflineRunRecord {
  readonly characterId: string;
  readonly idempotencyKey: string;
  readonly rulesVersion: number;
  readonly seed: string;
  /** The processed boundary before the claim: the start of the idle time. */
  readonly idleSince: Date;
  /** Start of the rewarded time: `idleSince`, or `claimedAt − cap` when capped. */
  readonly rewardedFrom: Date;
  /** The new processed boundary: `rewardedFrom` plus the fights' durations. */
  readonly processedUntil: Date;
  /** Server time of the claim: the end of the idle time. */
  readonly claimedAt: Date;
  /** Progress at the claim. Its stage progress is also the progress after it. */
  readonly before: CharacterProgress;
  /** The stage farmed. Always at most `before.stages.highestCleared`. */
  readonly targetStage: StageNumber;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly levelsGained: number;
  readonly rewards: StageRewards;
}

export interface OfflineRun extends OfflineRunRecord {
  readonly id: string;
}

/** The idle time a claim measured, in milliseconds of server time. */
export function elapsedOf(run: OfflineRunRecord): number {
  return run.claimedAt.getTime() - run.idleSince.getTime();
}

/** The part of the idle time that counted: at most the cap. */
export function rewardedOf(run: OfflineRunRecord): number {
  return run.claimedAt.getTime() - run.rewardedFrom.getTime();
}

/** The cap the claim ran under, from its own rule set. */
export function capOf(run: OfflineRunRecord): number {
  return getGameRules(run.rulesVersion).offline.capMs;
}

/**
 * The record of a claim that fought, exactly as Game Core resolved it. The
 * time line is anchored at `claimedAt`: the rewarded time ends there, and the
 * fights fill it from its start.
 *
 * @throws {Error} for a result without fights: such a claim is not recorded.
 */
export function recordOfflineClaim(
  result: OfflineProgressResult,
  context: {
    readonly characterId: string;
    readonly idempotencyKey: string;
    readonly idleSince: Date;
    readonly claimedAt: Date;
  },
): OfflineRunRecord {
  if (result.target === null || result.fights === 0) {
    throw new Error('Only a claim that fought is recorded.');
  }
  const rewardedFrom = new Date(context.claimedAt.getTime() - result.rewardedMs);
  return {
    ...context,
    rulesVersion: result.rulesVersion,
    seed: result.seed,
    rewardedFrom,
    processedUntil: new Date(rewardedFrom.getTime() + result.consumedMs),
    before: result.before,
    targetStage: result.target.number,
    fights: result.fights,
    wins: result.wins,
    losses: result.losses,
    levelsGained: result.levelsGained,
    rewards: result.rewards,
  };
}

/**
 * Re-resolves a stored claim from its inputs and checks it reproduces the
 * recorded summary. Anything else means determinism was broken — a defect.
 *
 * This is an audit, not part of serving a retry: a replayed claim is answered
 * from the stored summary, so a repeated key never costs a second simulation.
 */
export function verifyOfflineRun(run: OfflineRun): boolean {
  const result = resolveOfflineProgress({
    progress: run.before,
    elapsedMs: elapsedOf(run),
    seed: run.seed,
    rulesVersion: run.rulesVersion,
  });
  const expected = recordOfflineClaim(result, run);
  return (
    expected.targetStage.equals(run.targetStage) &&
    expected.rewardedFrom.getTime() === run.rewardedFrom.getTime() &&
    expected.processedUntil.getTime() === run.processedUntil.getTime() &&
    expected.fights === run.fights &&
    expected.wins === run.wins &&
    expected.losses === run.losses &&
    expected.levelsGained === run.levelsGained &&
    expected.rewards.gold.eq(run.rewards.gold) &&
    expected.rewards.experience.eq(run.rewards.experience)
  );
}
