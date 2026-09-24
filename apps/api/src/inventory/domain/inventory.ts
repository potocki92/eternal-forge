import type { EquipmentSlot, ItemInstance } from '@eternal-forge/game-core';

export interface OwnedItem {
  readonly item: ItemInstance;
  readonly createdAt: Date;
}
export type Equipment = Readonly<Record<EquipmentSlot, OwnedItem | null>>;
export interface InventoryState {
  readonly items: readonly OwnedItem[];
  readonly equipment: Equipment;
  readonly version: bigint;
}
