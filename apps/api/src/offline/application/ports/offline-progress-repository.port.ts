import type { HugeNumber } from '@eternal-forge/game-core';
import type { Character } from '../../../player/domain/player.js';
import type { OfflineRun, OfflineRunRecord } from '../../domain/offline-run.js';

/** Everything an offline claim reads, in one owner-scoped lookup. */
export interface OfflineClaimTarget {
  readonly character: Character;
  /** Optimistic concurrency token, shared with combat and stage selection. */
  readonly version: bigint;
  /** The server-held seed of this claim. Never leaves the API. */
  readonly offlineSeed: string;
  /** The claim this character already recorded under the request's key, if any. */
  readonly existingRun: OfflineRun | null;
}

export interface CommitOfflineClaim {
  readonly authUserId: string;
  readonly characterId: string;
  /** The `version` the claim was resolved from. Any other value means someone else won. */
  readonly expectedVersion: bigint;
  /** Level, experience and gold after the claim, exactly as Game Core returned them. */
  readonly level: number;
  readonly experience: HugeNumber;
  readonly gold: HugeNumber;
  /** The new processed boundary; also the next combat's earliest start. */
  readonly processedUntil: Date;
  /** A fresh seed for the character's next claim. */
  readonly nextOfflineSeed: string;
  readonly run: OfflineRunRecord;
}

export type CommitOfflineClaimResult =
  | { readonly kind: 'committed'; readonly run: OfflineRun; readonly character: Character }
  /** Nothing was written: the character changed since it was read, or the key was taken. */
  | { readonly kind: 'conflict' };

/**
 * Persistence port for offline progression (ADR-023).
 *
 * Reads are scoped by the caller's `authUserId`. The commit is atomic and
 * conditional on the character's version: the character's level, experience,
 * gold, processed boundary and offline seed, and the claim record, are written
 * together or not at all. It never writes a stage, the stage mode or a record.
 */
export interface OfflineProgressRepository {
  loadClaimTarget(
    authUserId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<OfflineClaimTarget | null>;

  commitClaim(command: CommitOfflineClaim): Promise<CommitOfflineClaimResult>;
}

export const OFFLINE_PROGRESS_REPOSITORY = Symbol('OFFLINE_PROGRESS_REPOSITORY');
