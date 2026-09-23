import type { StageMode, StageNumber } from '@eternal-forge/game-core';
import type { Character } from '../../domain/player.js';

/** An owned character together with the version it was read at. */
export interface VersionedCharacter {
  readonly character: Character;
  /** Optimistic concurrency token shared with combat (ADR-019 §5). */
  readonly version: bigint;
}

export interface SaveStageSelection {
  readonly authUserId: string;
  readonly characterId: string;
  /** The version the selection was validated against. Any other value means it is stale. */
  readonly expectedVersion: bigint;
  /** The stage Game Core placed the character on. */
  readonly currentStage: StageNumber;
  readonly stageMode: StageMode;
}

export type SaveStageSelectionResult =
  | { readonly kind: 'saved'; readonly character: Character }
  /** Nothing was written: the character changed since it was read. */
  | { readonly kind: 'conflict' };

/**
 * Persistence port for stage selection (ADR-021).
 *
 * Reads are scoped by the caller's `authUserId`. The save is conditional on
 * the version, like a combat commit, and writes only the current stage and
 * the mode: it has no way to write a record, a reward or a level.
 */
export interface StageSelectionRepository {
  loadOwnedCharacter(authUserId: string, characterId: string): Promise<VersionedCharacter | null>;

  saveSelection(command: SaveStageSelection): Promise<SaveStageSelectionResult>;
}

export const STAGE_SELECTION_REPOSITORY = Symbol('STAGE_SELECTION_REPOSITORY');
