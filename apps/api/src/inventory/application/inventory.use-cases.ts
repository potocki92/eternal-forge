import { Inject, Injectable } from '@nestjs/common';
import { ITEM_CATALOG, ItemInstanceId, type EquipmentSlot } from '@eternal-forge/game-core';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import type { InventoryState } from '../domain/inventory.js';
import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
} from './ports/inventory-repository.port.js';

export type InventoryResult =
  { readonly kind: 'found'; readonly state: InventoryState } | { readonly kind: 'not-found' };
export type MutationResult = InventoryResult | { readonly kind: 'conflict' };
const MAX_ATTEMPTS = 3;

@Injectable()
export class GetInventoryUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private readonly repository: InventoryRepository) {}
  async execute(identity: AuthenticatedIdentity, characterId: string): Promise<InventoryResult> {
    const state = await this.repository.loadOwned(identity.authUserId, characterId);
    return state === null ? { kind: 'not-found' } : { kind: 'found', state };
  }
}
@Injectable()
export class GetEquipmentUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private readonly repository: InventoryRepository) {}
  async execute(identity: AuthenticatedIdentity, characterId: string): Promise<InventoryResult> {
    const state = await this.repository.loadOwned(identity.authUserId, characterId);
    return state === null ? { kind: 'not-found' } : { kind: 'found', state };
  }
}

@Injectable()
export class EquipItemUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private readonly repository: InventoryRepository) {}
  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
    rawId: string,
  ): Promise<MutationResult> {
    const itemId = ItemInstanceId.parse(rawId);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const state = await this.repository.loadOwned(identity.authUserId, characterId);
      if (state === null) return { kind: 'not-found' };
      const owned = state.items.find(({ item }) => item.id.equals(itemId));
      // Foreign and unknown item IDs deliberately have the same result.
      if (owned === undefined) return { kind: 'not-found' };
      const slot = ITEM_CATALOG.require(owned.item.definitionId).slot;
      if (state.equipment[slot]?.item.id.equals(itemId) === true) return { kind: 'found', state };
      const saved = await this.repository.changeEquipment({
        authUserId: identity.authUserId,
        characterId,
        expectedVersion: state.version,
        slot,
        itemInstanceId: itemId.toString(),
      });
      if (saved === 'saved') {
        const current = await this.repository.loadOwned(identity.authUserId, characterId);
        if (current !== null) return { kind: 'found', state: current };
      }
    }
    return { kind: 'conflict' };
  }
}

@Injectable()
export class UnequipItemUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private readonly repository: InventoryRepository) {}
  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
    slot: EquipmentSlot,
  ): Promise<MutationResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const state = await this.repository.loadOwned(identity.authUserId, characterId);
      if (state === null) return { kind: 'not-found' };
      if (state.equipment[slot] === null) return { kind: 'found', state };
      const saved = await this.repository.changeEquipment({
        authUserId: identity.authUserId,
        characterId,
        expectedVersion: state.version,
        slot,
        itemInstanceId: null,
      });
      if (saved === 'saved') {
        const current = await this.repository.loadOwned(identity.authUserId, characterId);
        if (current !== null) return { kind: 'found', state: current };
      }
    }
    return { kind: 'conflict' };
  }
}
