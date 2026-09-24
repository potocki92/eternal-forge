import {
  createItemInstance,
  ITEM_CATALOG,
  ItemDefinitionId,
  ItemInstanceId,
} from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import { EquipItemUseCase, UnequipItemUseCase } from './inventory.use-cases.js';
import type { InventoryRepository } from './ports/inventory-repository.port.js';
const identity = { authUserId: 'owner', sessionId: undefined };
const sword = createItemInstance(
  {
    id: ItemInstanceId.parse('11111111-1111-4111-8111-111111111111'),
    definitionId: ItemDefinitionId.parse('forged_iron_sword'),
    rarity: 'RARE',
  },
  ITEM_CATALOG,
);
function fixture(): {
  repository: InventoryRepository;
  equipped: { value: boolean };
  version: { value: bigint };
} {
  const equipped = { value: false };
  const version = { value: 0n };
  const repository: InventoryRepository = {
    loadOwned: (owner, character) =>
      Promise.resolve(
        owner !== 'owner' || character !== 'hero'
          ? null
          : {
              items: [{ item: sword, createdAt: new Date(0) }],
              equipment: {
                WEAPON: equipped.value ? { item: sword, createdAt: new Date(0) } : null,
                HELMET: null,
                CHEST: null,
                GLOVES: null,
                BOOTS: null,
                RING: null,
                AMULET: null,
              },
              version: version.value,
            },
      ),
    changeEquipment: (command) => {
      if (command.expectedVersion !== version.value) return Promise.resolve('conflict');
      equipped.value = command.itemInstanceId !== null;
      version.value += 1n;
      return Promise.resolve('saved');
    },
    createTrustedItem: () => Promise.resolve(),
  };
  return { repository, equipped, version };
}
describe('equipment use cases', () => {
  it('derives WEAPON from the catalog, equips, and retries as a no-op', async () => {
    const state = fixture();
    const useCase = new EquipItemUseCase(state.repository);
    expect((await useCase.execute(identity, 'hero', sword.id.toString())).kind).toBe('found');
    expect(state.equipped.value).toBe(true);
    expect(state.version.value).toBe(1n);
    await useCase.execute(identity, 'hero', sword.id.toString());
    expect(state.version.value).toBe(1n);
  });
  it('hides foreign/unknown items and unequips empty slots idempotently', async () => {
    const state = fixture();
    expect(
      (await new EquipItemUseCase(state.repository).execute(identity, 'other', sword.id.toString()))
        .kind,
    ).toBe('not-found');
    expect(
      (await new UnequipItemUseCase(state.repository).execute(identity, 'hero', 'WEAPON')).kind,
    ).toBe('found');
    expect(state.version.value).toBe(0n);
  });
});
