import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  equipmentResponseSchema,
  inventoryResponseSchema,
  playerStateResponseSchema,
} from '@eternal-forge/contracts';
import {
  ITEM_CATALOG,
  ItemDefinitionId,
  ItemInstanceId,
  createItemInstance,
} from '@eternal-forge/game-core';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChangeEquipmentCommand,
  InventoryRepository,
} from '../src/inventory/application/ports/inventory-repository.port.js';
import type { InventoryState } from '../src/inventory/domain/inventory.js';
import { createTestApp, httpServer } from './support/create-test-app.js';
import { InMemoryGameRepository } from './support/in-memory-game.repository.js';
import { TestTokenIssuer } from './support/token-issuer.js';

let issuer: TestTokenIssuer;
let app: INestApplication;
let game: InMemoryGameRepository;
let inventory: TestInventoryRepository;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
});
beforeEach(async () => {
  game = new InMemoryGameRepository();
  inventory = new TestInventoryRepository();
  app = await createTestApp({
    issuer,
    players: game,
    combats: game,
    selections: game,
    inventory,
  });
});
afterEach(async () => app.close());

async function provision() {
  const authUserId = randomUUID();
  const token = await issuer.issue({ sub: authUserId });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const characterId = playerStateResponseSchema.parse(response.body).character.id;
  inventory.owner = { authUserId, characterId };
  return { token, characterId };
}

const sword = createItemInstance(
  {
    id: ItemInstanceId.parse('11111111-1111-4111-8111-111111111111'),
    definitionId: ItemDefinitionId.parse('forged_iron_sword'),
    rarity: 'RARE',
  },
  ITEM_CATALOG,
);

class TestInventoryRepository implements InventoryRepository {
  owner: { authUserId: string; characterId: string } | undefined;
  private equipped = false;
  private version = 0n;

  loadOwned(authUserId: string, characterId: string): Promise<InventoryState | null> {
    if (this.owner?.authUserId !== authUserId || this.owner.characterId !== characterId) {
      return Promise.resolve(null);
    }
    const owned = { item: sword, createdAt: new Date('2026-09-24T00:00:00.000Z') };
    return Promise.resolve({
      items: [owned],
      equipment: {
        WEAPON: this.equipped ? owned : null,
        HELMET: null,
        CHEST: null,
        GLOVES: null,
        BOOTS: null,
        RING: null,
        AMULET: null,
      },
      version: this.version,
    });
  }
  changeEquipment(command: ChangeEquipmentCommand): Promise<'saved' | 'conflict'> {
    if (command.expectedVersion !== this.version) return Promise.resolve('conflict');
    this.equipped = command.itemInstanceId !== null;
    this.version += 1n;
    return Promise.resolve('saved');
  }
  createTrustedItem(): Promise<void> {
    return Promise.resolve();
  }
}

function auth(call: request.Test, token: string): request.Test {
  return call.set('authorization', `Bearer ${token}`);
}

describe('inventory/equipment HTTP authority', () => {
  it('requires authentication and hides foreign characters', async () => {
    const owner = await provision();
    await request(httpServer(app))
      .get(`/player/characters/${owner.characterId}/inventory`)
      .expect(401);
    const stranger = await issuer.issue({ sub: randomUUID() });
    const response = await auth(
      request(httpServer(app)).get(`/player/characters/${owner.characterId}/equipment`),
      stranger,
    ).expect(404);
    expect(apiErrorResponseSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('reads inventory and returns authoritative equipment after equip and unequip', async () => {
    const owner = await provision();
    const inventoryBody = inventoryResponseSchema.parse(
      (
        await auth(
          request(httpServer(app)).get(`/player/characters/${owner.characterId}/inventory`),
          owner.token,
        ).expect(200)
      ).body,
    );
    expect(inventoryBody.ownedItems[0]?.slot).toBe('WEAPON');

    const equipped = equipmentResponseSchema.parse(
      (
        await auth(
          request(httpServer(app)).post(`/player/characters/${owner.characterId}/equipment/equip`),
          owner.token,
        )
          .send({ itemInstanceId: sword.id.toString() })
          .expect(200)
      ).body,
    );
    expect(equipped.equipment.WEAPON?.id).toBe(sword.id.toString());
    expect(equipped.characterVersion).toBe('1');

    const unequipped = equipmentResponseSchema.parse(
      (
        await auth(
          request(httpServer(app)).post(
            `/player/characters/${owner.characterId}/equipment/unequip`,
          ),
          owner.token,
        )
          .send({ slot: 'WEAPON' })
          .expect(200)
      ).body,
    );
    expect(unequipped.equipment.WEAPON).toBeNull();
  });

  it.each([
    { itemInstanceId: sword.id.toString(), slot: 'HELMET' },
    { itemInstanceId: sword.id.toString(), rarity: 'MYTHIC' },
    { itemInstanceId: sword.id.toString(), definitionId: 'forgeheart_amulet' },
  ])('rejects client-authoritative Equip fields: %j', async (body) => {
    const owner = await provision();
    const response = await auth(
      request(httpServer(app)).post(`/player/characters/${owner.characterId}/equipment/equip`),
      owner.token,
    )
      .send(body)
      .expect(400);
    expect(apiErrorResponseSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects malformed IDs and slots and does not reveal an unknown item', async () => {
    const owner = await provision();
    await auth(
      request(httpServer(app)).get('/player/characters/not-a-uuid/inventory'),
      owner.token,
    ).expect(400);
    await auth(
      request(httpServer(app)).post(`/player/characters/${owner.characterId}/equipment/equip`),
      owner.token,
    )
      .send({ itemInstanceId: 'bad' })
      .expect(400);
    await auth(
      request(httpServer(app)).post(`/player/characters/${owner.characterId}/equipment/unequip`),
      owner.token,
    )
      .send({ slot: 'weapon' })
      .expect(400);
    const response = await auth(
      request(httpServer(app)).post(`/player/characters/${owner.characterId}/equipment/equip`),
      owner.token,
    )
      .send({ itemInstanceId: randomUUID() })
      .expect(404);
    expect(apiErrorResponseSchema.parse(response.body).code).toBe('NOT_FOUND');
  });
});
