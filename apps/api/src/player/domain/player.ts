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
 * Combat stats are not here: Game Core derives them from `level` under a
 * versioned rule set, so storing them would only create a second, stale truth.
 */
export interface Character {
  readonly id: string;
  readonly profileId: string;
  readonly slot: number;
  readonly name: string;
  readonly level: number;
  /** Current stage. A safe integer in the domain; bigint in PostgreSQL. */
  readonly stage: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
export const NEW_CHARACTER_STATE = { level: 1, stage: 1 } as const;
