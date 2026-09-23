import type { HugeNumber, StageProgress } from '@eternal-forge/game-core';
import type { Character, Player } from '../../domain/player.js';

export interface ProvisionPlayerData {
  readonly authUserId: string;
  readonly displayName: string;
  readonly characterName: string;
  readonly characterSlot: number;
  readonly characterLevel: number;
  readonly characterStages: StageProgress;
  readonly characterExperience: HugeNumber;
  readonly characterGold: HugeNumber;
  /**
   * When the new character may fight: the application clock's "now". The
   * pacing gate compares against the same clock, so the database clock never
   * decides it (ADR-019).
   */
  readonly characterNextCombatAt: Date;
}

export interface ProvisionPlayerOutcome {
  readonly player: Player;
  /** True when this call created the profile or the main character. */
  readonly created: boolean;
}

/**
 * Persistence port for player identity data.
 *
 * Every read is scoped by the caller's `authUserId`: the port offers no way to
 * load a player or character by id alone, so ownership cannot be forgotten at a
 * call site (docs/SECURITY.md — "Authorization").
 */
export interface PlayerRepository {
  /** The provisioned player for an identity, or `null` if not (fully) provisioned. */
  findByAuthUserId(authUserId: string): Promise<Player | null>;

  /** A character, only if it belongs to the identity. Someone else's is `null`. */
  findOwnedCharacter(authUserId: string, characterId: string): Promise<Character | null>;

  /**
   * Ensures a profile and main character exist for the identity.
   *
   * Atomic and idempotent: concurrent and repeated calls converge on exactly
   * one profile and one main character. Existing rows are never modified, so
   * the first successful call's names win.
   */
  provision(data: ProvisionPlayerData): Promise<ProvisionPlayerOutcome>;
}

export const PLAYER_REPOSITORY = Symbol('PLAYER_REPOSITORY');
