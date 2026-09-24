import type { EquipmentSlot, ItemInstance } from '@eternal-forge/game-core';
import type { InventoryState } from '../../domain/inventory.js';

export type LoadInventoryResult = InventoryState | null;
export interface ChangeEquipmentCommand {
  readonly authUserId: string;
  readonly characterId: string;
  readonly expectedVersion: bigint;
  readonly slot: EquipmentSlot;
  readonly itemInstanceId: string | null;
}
export interface TrustedItemInstance {
  readonly characterId: string;
  readonly item: ItemInstance;
  readonly createdAt?: Date;
}
export interface InventoryRepository {
  loadOwned(authUserId: string, characterId: string): Promise<LoadInventoryResult>;
  changeEquipment(command: ChangeEquipmentCommand): Promise<'saved' | 'conflict'>;
  /** Trusted server systems only. This is intentionally not exposed by an HTTP use case. */
  createTrustedItem(input: TrustedItemInstance): Promise<void>;
}
export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');
