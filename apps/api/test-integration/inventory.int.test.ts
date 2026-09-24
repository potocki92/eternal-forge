import { randomUUID } from 'node:crypto';
import {
  ITEM_CATALOG,
  ItemDefinitionId,
  ItemInstanceId,
  createItemInstance,
} from '@eternal-forge/game-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaInventoryRepository } from '../src/inventory/infrastructure/prisma-inventory.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';
let prisma: PrismaService;
beforeAll(() => {
  prisma = connectTestDatabase();
});
afterAll(async () => prisma.onModuleDestroy());
beforeEach(async () => resetPlayerTables(prisma));
async function character() {
  const authUserId = randomUUID();
  const profile = await prisma.client.profile.create({
    data: { authUserId, displayName: 'Owner' },
  });
  const row = await prisma.client.character.create({
    data: { profileId: profile.id, slot: 1, name: 'Hero' },
  });
  return { authUserId, characterId: row.id };
}
async function item(
  repository: PrismaInventoryRepository,
  characterId: string,
  definitionId: string,
) {
  const value = createItemInstance(
    {
      id: ItemInstanceId.parse(randomUUID()),
      definitionId: ItemDefinitionId.parse(definitionId),
      rarity: 'RARE',
    },
    ITEM_CATALOG,
  );
  await repository.createTrustedItem({ characterId, item: value });
  return value.id.toString();
}
describe('inventory/equipment PostgreSQL invariants', () => {
  it('concurrent weapon equips across repository instances leave exactly one valid result', async () => {
    const owner = await character();
    const first = new PrismaInventoryRepository(prisma);
    const second = new PrismaInventoryRepository(prisma);
    const swordA = await item(first, owner.characterId, 'forged_iron_sword');
    const swordB = await item(first, owner.characterId, 'forged_iron_sword');
    const version = (await first.loadOwned(owner.authUserId, owner.characterId))!.version;
    const results = await Promise.all([
      first.changeEquipment({
        ...owner,
        expectedVersion: version,
        slot: 'WEAPON',
        itemInstanceId: swordA,
      }),
      second.changeEquipment({
        ...owner,
        expectedVersion: version,
        slot: 'WEAPON',
        itemInstanceId: swordB,
      }),
    ]);
    expect(results.sort()).toEqual(['conflict', 'saved']);
    const state = await first.loadOwned(owner.authUserId, owner.characterId);
    expect(state?.items).toHaveLength(2);
    expect(state?.equipment.WEAPON).not.toBeNull();
    expect(
      await prisma.client.characterEquipment.count({
        where: { characterId: owner.characterId, slot: 'WEAPON' },
      }),
    ).toBe(1);
  });
  it('the composite FK rejects foreign ownership and rolls back the version increment', async () => {
    const alice = await character();
    const bob = await character();
    const repository = new PrismaInventoryRepository(prisma);
    const bobsSword = await item(repository, bob.characterId, 'forged_iron_sword');
    const before = await prisma.client.character.findUniqueOrThrow({
      where: { id: alice.characterId },
    });
    await expect(
      repository.changeEquipment({
        ...alice,
        expectedVersion: before.version,
        slot: 'WEAPON',
        itemInstanceId: bobsSword,
      }),
    ).rejects.toThrow();
    expect(
      (await prisma.client.character.findUniqueOrThrow({ where: { id: alice.characterId } }))
        .version,
    ).toBe(before.version);
    expect(
      await prisma.client.characterEquipment.count({ where: { characterId: alice.characterId } }),
    ).toBe(0);
  });
  it('replacement and empty unequip are atomic and retry-safe', async () => {
    const owner = await character();
    const repository = new PrismaInventoryRepository(prisma);
    const a = await item(repository, owner.characterId, 'forged_iron_sword');
    const b = await item(repository, owner.characterId, 'forged_iron_sword');
    expect(
      await repository.changeEquipment({
        ...owner,
        expectedVersion: 0n,
        slot: 'WEAPON',
        itemInstanceId: a,
      }),
    ).toBe('saved');
    expect(
      await repository.changeEquipment({
        ...owner,
        expectedVersion: 1n,
        slot: 'WEAPON',
        itemInstanceId: b,
      }),
    ).toBe('saved');
    expect(
      (
        await repository.loadOwned(owner.authUserId, owner.characterId)
      )?.equipment.WEAPON?.item.id.toString(),
    ).toBe(b);
    expect(
      await repository.changeEquipment({
        ...owner,
        expectedVersion: 2n,
        slot: 'WEAPON',
        itemInstanceId: null,
      }),
    ).toBe('saved');
  });
});
