import type {
  EquipmentResponse,
  InventoryResponse,
  ItemInstanceDto,
} from '@eternal-forge/contracts';
import { ITEM_CATALOG } from '@eternal-forge/game-core';
import type { InventoryState, OwnedItem } from '../domain/inventory.js';

export function toItemDto(owned: OwnedItem): ItemInstanceDto {
  const definition = ITEM_CATALOG.require(owned.item.definitionId);
  return {
    id: owned.item.id.toString(),
    definitionId: owned.item.definitionId.toString(),
    rarity: owned.item.rarity,
    nameKey: definition.nameKey,
    slot: definition.slot,
    createdAt: owned.createdAt.toISOString(),
  };
}
export function toInventoryResponse(state: InventoryState): InventoryResponse {
  return { ownedItems: state.items.map(toItemDto) };
}
export function toEquipmentResponse(state: InventoryState): EquipmentResponse {
  const map = (slot: keyof InventoryState['equipment']) =>
    state.equipment[slot] === null ? null : toItemDto(state.equipment[slot]);
  return {
    equipment: {
      WEAPON: map('WEAPON'),
      HELMET: map('HELMET'),
      CHEST: map('CHEST'),
      GLOVES: map('GLOVES'),
      BOOTS: map('BOOTS'),
      RING: map('RING'),
      AMULET: map('AMULET'),
    },
    characterVersion: state.version.toString(),
  };
}
