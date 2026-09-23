import {
  HugeNumber,
  INITIAL_STAGE_PROGRESS,
  type CharacterProgress,
  type StageProgress,
} from '@eternal-forge/game-core';

/**
 * Player domain model.
 *
 * These are domain types, not persistence models and not API contracts
 * (CLAUDE.md — "Persistence"). The repository maps rows onto them; the
 * presentation layer maps them onto the shared contract.
 */

/** A player's application profile. Linked to exactly one authentication identity. */
export interface Profile {
  readonly id: string;
  readonly authUserId: string;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A character's persistent *source* state.
 *
 * Combat stats, the experience requirement and the next enemy are not here:
 * Game Core derives them under a versioned rule set, so storing them would
 * only create a second, stale truth.
 */
export interface Character {
  readonly id: string;
  readonly profileId: string;
  readonly slot: number;
  readonly name: string;
  readonly level: number;
  /**
   * The stage fought next and the records set so far (ADR-020). Each is exact
   * to 2^63 − 1, a PostgreSQL `bigint` (ADR-018).
   */
  readonly stages: StageProgress;
  /** Experience within the current level. A whole, non-negative amount. */
  readonly experience: HugeNumber;
  readonly gold: HugeNumber;
  /** Server time before which the character is still fighting (ADR-019). */
  readonly nextCombatAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The part of a character that gameplay reads and writes, in Game Core's terms. */
export function progressOf(character: Character): CharacterProgress {
  return {
    level: character.level,
    experience: character.experience,
    gold: character.gold,
    stages: character.stages,
  };
}

/** A provisioned player: a profile together with its main character. */
export interface Player {
  readonly profile: Profile;
  readonly mainCharacter: Character;
}

/**
 * The slot holding a profile's main character. Characters are keyed by
 * `(profileId, slot)`, so further slots are a product decision, not a migration.
 */
export const MAIN_CHARACTER_SLOT = 1;

/** Where every new character starts. */
export const NEW_CHARACTER_STATE = {
  level: 1,
  stages: INITIAL_STAGE_PROGRESS,
  experience: HugeNumber.ZERO,
  gold: HugeNumber.ZERO,
} as const;
