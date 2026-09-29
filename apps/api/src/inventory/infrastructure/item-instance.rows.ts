import {
  ITEM_CATALOG,
  parseItemInstance,
  parseRolledAffix,
  type ItemInstance,
} from '@eternal-forge/game-core';
import type { OwnedItem } from '../domain/inventory.js';

/**
 * The persisted shape of one item instance with its affix rolls, declared
 * locally so Prisma types stop at the adapters. Every adapter that reads an
 * instance (inventory, combat, character stats) maps it through here, so a
 * persisted item has exactly one interpretation.
 */
export interface ItemInstanceRow {
  readonly id: string;
  readonly definitionId: string;
  readonly rarity: string;
  readonly generationVersion: number;
  /** Must be loaded ordered by `position`. */
  readonly affixes: readonly {
    readonly id: string;
    readonly affixDefinitionId: string;
    readonly stat: string;
    readonly operation: string;
    readonly value: string;
    readonly position: number;
  }[];
}

/** Parses through the catalog and fails loudly on malformed persisted data (ADR-025, ADR-028). */
export function toItemInstance(row: ItemInstanceRow): ItemInstance {
  return parseItemInstance(
    {
      id: row.id,
      definitionId: row.definitionId,
      rarity: row.rarity,
      generationVersion: row.generationVersion,
      affixes: row.affixes.map((roll) =>
        parseRolledAffix({
          id: roll.id,
          definitionId: roll.affixDefinitionId,
          stat: roll.stat,
          operation: roll.operation,
          value: roll.value,
          position: roll.position,
        }),
      ),
    },
    ITEM_CATALOG,
  );
}

export function toOwnedItem(row: ItemInstanceRow & { readonly createdAt: Date }): OwnedItem {
  return { item: toItemInstance(row), createdAt: row.createdAt };
}
