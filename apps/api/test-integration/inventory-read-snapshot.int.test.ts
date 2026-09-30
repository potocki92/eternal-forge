import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  equipmentResponseSchema,
  playerStateResponseSchema,
  type EquipmentResponse,
} from '@eternal-forge/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import type { InventoryState } from '../src/inventory/domain/inventory.js';
import { PrismaInventoryRepository } from '../src/inventory/infrastructure/prisma-inventory.repository.js';
import {
  toEquipmentResponse,
  toInventoryResponse,
} from '../src/inventory/presentation/inventory.mapper.js';
import { PrismaPlayerRepository } from '../src/player/infrastructure/prisma-player.repository.js';
import { PrismaStageSelectionRepository } from '../src/player/infrastructure/prisma-stage-selection.repository.js';
import { createTestApp, httpServer } from '../test/support/create-test-app.js';
import { TestTokenIssuer } from '../test/support/token-issuer.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';
import { StatementGate } from './statement-gate.js';

/**
 * One inventory/equipment read is one committed state (ADR-025, ADR-030 §6).
 *
 * Prisma loads the character, its owned items, their rolls and its equipment
 * with separate SELECTs. `characterVersion` from `GET /equipment` identifies
 * the loadout it is returned with — the web keys equipment previews by it —
 * so a read must never pair one version with another version's equipment or
 * items.
 *
 * The statement gate stops the read before each of its statements in turn,
 * commits a competing write while it waits, then lets it finish. That covers
 * every point at which a commit can land inside the read, deterministically:
 * each answer must be exactly the state before the write or the state after
 * it.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let app: INestApplication;
const gate = new StatementGate();

beforeAll(async () => {
  prisma = connectTestDatabase();
  issuer = await TestTokenIssuer.create();
  gate.install();
});

afterAll(async () => {
  gate.uninstall();
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  await resetPlayerTables(prisma);
  app = await createTestApp({
    issuer,
    players: new PrismaPlayerRepository(prisma),
    combats: new PrismaCombatRepository(prisma),
    selections: new PrismaStageSelectionRepository(prisma),
    inventory: new PrismaInventoryRepository(prisma),
  });
});

afterEach(async () => {
  await app.close();
});

async function provisionedPlayer() {
  const authUserId = randomUUID();
  const token = await issuer.issue({ sub: authUserId });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const characterId = playerStateResponseSchema.parse(response.body).character.id;
  return { authUserId, token, characterId };
}

/** Trusted fixture: an owned sword with persisted rolls, as a drop creates it. */
async function grantSword(characterId: string, damage: string) {
  const row = await prisma.client.itemInstance.create({
    data: {
      characterId,
      definitionId: 'forged_iron_sword',
      rarity: 'RARE',
      generationVersion: 1,
      affixes: {
        create: [
          {
            affixDefinitionId: 'damage_flat',
            stat: 'DAMAGE',
            operation: 'FLAT',
            value: damage,
            generationVersion: 1,
            position: 0,
          },
          {
            affixDefinitionId: 'critical_chance_flat',
            stat: 'CRITICAL_CHANCE',
            operation: 'FLAT',
            value: '200',
            generationVersion: 1,
            position: 1,
          },
        ],
      },
    },
  });
  return row.id;
}

async function getEquipment(token: string, characterId: string): Promise<EquipmentResponse> {
  const response = await request(httpServer(app))
    .get(`/player/characters/${characterId}/equipment`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return equipmentResponseSchema.parse(response.body);
}

async function equip(
  token: string,
  characterId: string,
  itemInstanceId: string,
): Promise<EquipmentResponse> {
  const response = await request(httpServer(app))
    .post(`/player/characters/${characterId}/equipment/equip`)
    .set('authorization', `Bearer ${token}`)
    .send({ itemInstanceId })
    .expect(200);
  return equipmentResponseSchema.parse(response.body);
}

/** Everything a read returns, as plain wire data, so two reads compare by value. */
function snapshotOf(state: InventoryState | null) {
  if (state === null) throw new Error('The character must exist.');
  return { inventory: toInventoryResponse(state), equipment: toEquipmentResponse(state) };
}

describe('inventory and equipment reads are snapshot-coherent', () => {
  it('GET /equipment racing POST /equipment/equip answers the loadout before or after, at every statement boundary', async () => {
    const { token, characterId } = await provisionedPlayer();
    const swordA = await grantSword(characterId, '1e1');
    const swordB = await grantSword(characterId, '2.5e1');
    await equip(token, characterId, swordA);

    const statements = await gate.record(() => getEquipment(token, characterId));
    // The race exists only because the read is several statements.
    expect(statements.some((text) => text.includes('"character_equipment"'))).toBe(true);
    expect(statements.length).toBeGreaterThan(2);

    const answered = new Set<'before' | 'after'>();
    for (let index = 0; index < statements.length; index += 1) {
      const before = await equip(token, characterId, swordA);
      let after: EquipmentResponse | null = null;
      const read = await gate.pauseBefore(
        index,
        () => getEquipment(token, characterId),
        async () => {
          after = await equip(token, characterId, swordB);
        },
      );

      expect(after).not.toBeNull();
      expect(after).not.toEqual(before);
      // Never version N with N + 1's equipment, nor the reverse.
      expect([before, after]).toContainEqual(read);
      answered.add(read.characterVersion === before.characterVersion ? 'before' : 'after');
    }
    // A commit landing before the read began is seen; one landing inside it is not.
    expect(answered).toEqual(new Set(['before', 'after']));
  });

  it('loadOwned racing a version-bumping item grant returns one state for version, items, rolls and equipment', async () => {
    const { authUserId, token, characterId } = await provisionedPlayer();
    const swordA = await grantSword(characterId, '1e1');
    await grantSword(characterId, '1.5e1');
    await equip(token, characterId, swordA);
    const repository = new PrismaInventoryRepository(prisma);
    const load = () => repository.loadOwned(authUserId, characterId);

    const statements = await gate.record(load);
    expect(statements.length).toBeGreaterThan(2);

    const answered = new Set<'before' | 'after'>();
    for (let index = 0; index < statements.length; index += 1) {
      const before = snapshotOf(await load());
      // The shape of a combat reward commit (ADR-026, ADR-028): the version
      // moves together with a new owned item and its rolls.
      const read = snapshotOf(
        await gate.pauseBefore(index, load, async () => {
          await prisma.client.$transaction([
            prisma.client.character.update({
              where: { id: characterId },
              data: { version: { increment: 1 } },
            }),
            prisma.client.itemInstance.create({
              data: {
                characterId,
                definitionId: 'runed_iron_ring',
                rarity: 'MAGIC',
                generationVersion: 1,
                affixes: {
                  create: {
                    affixDefinitionId: 'damage_flat',
                    stat: 'DAMAGE',
                    operation: 'FLAT',
                    value: '5e0',
                    generationVersion: 1,
                    position: 0,
                  },
                },
              },
            }),
          ]);
        }),
      );
      const after = snapshotOf(await load());

      expect(after.equipment.characterVersion).not.toBe(before.equipment.characterVersion);
      expect(after.inventory.ownedItems).toHaveLength(before.inventory.ownedItems.length + 1);
      expect([before, after]).toContainEqual(read);
      answered.add(
        read.equipment.characterVersion === before.equipment.characterVersion ? 'before' : 'after',
      );
    }
    expect(answered).toEqual(new Set(['before', 'after']));
  });
});
