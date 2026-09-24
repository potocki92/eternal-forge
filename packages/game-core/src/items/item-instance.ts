import type { ItemDefinition } from './item-definition.js';
import type { ItemRarity } from './item-rarity.js';
import { parseItemRarity } from './item-rarity.js';
import type { ItemCatalog } from './item-catalog.js';
import { ItemDefinitionId, ItemInstanceId } from './item-id.js';

/** Minimal authoritative source state for one owned equipment item. */
export interface ItemInstance {
  readonly id: ItemInstanceId;
  readonly definitionId: ItemDefinitionId;
  readonly rarity: ItemRarity;
}

export interface CreateItemInstanceInput {
  readonly id: ItemInstanceId;
  readonly definitionId: ItemDefinitionId;
  readonly rarity: ItemRarity;
}

export interface SerializedItemInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly rarity: string;
}

export function createItemInstance(
  input: CreateItemInstanceInput,
  catalog: ItemCatalog,
): ItemInstance {
  catalog.require(input.definitionId);
  return Object.freeze({
    id: input.id,
    definitionId: input.definitionId,
    rarity: input.rarity,
  });
}

export function itemDefinitionFor(instance: ItemInstance, catalog: ItemCatalog): ItemDefinition {
  return catalog.require(instance.definitionId);
}

export function serializeItemInstance(instance: ItemInstance): SerializedItemInstance {
  return Object.freeze({
    id: instance.id.toString(),
    definitionId: instance.definitionId.toString(),
    rarity: instance.rarity,
  });
}

export function parseItemInstance(
  serialized: SerializedItemInstance,
  catalog: ItemCatalog,
): ItemInstance {
  return createItemInstance(
    {
      id: ItemInstanceId.parse(serialized.id),
      definitionId: ItemDefinitionId.parse(serialized.definitionId),
      rarity: parseItemRarity(serialized.rarity),
    },
    catalog,
  );
}
