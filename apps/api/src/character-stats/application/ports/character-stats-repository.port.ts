import type { Equipment, OwnedItem } from '../../../inventory/domain/inventory.js';

/** Everything a stats query reads, from one owner-scoped lookup. */
export interface CharacterLoadout {
  readonly level: number;
  /** The optimistic-concurrency version the loadout was read at. */
  readonly version: bigint;
  /** Authoritative equipped instances with their persisted rolls. Inventory is not read. */
  readonly equipment: Equipment;
  /**
   * The requested candidate when it exists *and* belongs to this character;
   * `null` otherwise, so a foreign and a missing item are indistinguishable.
   */
  readonly candidate: OwnedItem | null;
}

/**
 * Read-only persistence port for character stats and equipment previews
 * (ADR-030). It has no write method: a stats query or a preview can never
 * change a character, its equipment or its version.
 */
export interface CharacterStatsRepository {
  loadLoadout(
    authUserId: string,
    characterId: string,
    candidateItemId: string | null,
  ): Promise<CharacterLoadout | null>;
}

export const CHARACTER_STATS_REPOSITORY = Symbol('CHARACTER_STATS_REPOSITORY');
