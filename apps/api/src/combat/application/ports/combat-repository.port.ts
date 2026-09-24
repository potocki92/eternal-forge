import type { CharacterProgress, ItemDrop } from '@eternal-forge/game-core';
import type { Character } from '../../../player/domain/player.js';
import type { CombatRun, CombatRunRecord } from '../../domain/combat-run.js';

/** Everything a combat request reads, in one owner-scoped lookup. */
export interface CombatTarget {
  readonly character: Character;
  /** Optimistic concurrency token, read together with the character. */
  readonly version: bigint;
  /** The combat this character already resolved under the request's key, if any. */
  readonly existingRun: CombatRun | null;
}

export interface CommitCombat {
  readonly authUserId: string;
  readonly characterId: string;
  /** The `version` the combat was resolved from. Any other value means someone else won. */
  readonly expectedVersion: bigint;
  /** Progress after the combat, exactly as Game Core returned it. */
  readonly progress: CharacterProgress;
  readonly nextCombatAt: Date;
  readonly run: CombatRunRecord;
  /** Generation data only. Infrastructure creates the persistent UUID in this transaction. */
  readonly itemDrop: ItemDrop | null;
}

export type CommitCombatResult =
  | { readonly kind: 'committed'; readonly run: CombatRun }
  /**
   * Nothing was written: the character changed since it was read, or the
   * idempotency key was taken by a concurrent request.
   */
  | { readonly kind: 'conflict' };

/**
 * Persistence port for resolving combats (ADR-019).
 *
 * Reads are scoped by the caller's `authUserId`, like every player port. The
 * commit is atomic and conditional: the character update and the combat
 * record are written together, and only if the character still has the
 * expected version.
 */
export interface CombatRepository {
  loadTarget(
    authUserId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<CombatTarget | null>;

  commit(command: CommitCombat): Promise<CommitCombatResult>;
}

export const COMBAT_REPOSITORY = Symbol('COMBAT_REPOSITORY');
