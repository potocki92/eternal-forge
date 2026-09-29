import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  characterStatsResponseSchema,
  statsPreviewResponseSchema,
} from '@eternal-forge/contracts';
import {
  ITEM_CATALOG,
  ItemDefinitionId,
  ItemInstanceId,
  createItemInstance,
  type RolledAffix,
} from '@eternal-forge/game-core';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  CharacterLoadout,
  CharacterStatsRepository,
} from '../src/character-stats/application/ports/character-stats-repository.port.js';
import type { Equipment, OwnedItem } from '../src/inventory/domain/inventory.js';
import { createTestApp, httpServer } from './support/create-test-app.js';
import { InMemoryGameRepository } from './support/in-memory-game.repository.js';
import { TestTokenIssuer } from './support/token-issuer.js';

/**
 * HTTP-level behaviour of the character stat queries (ADR-030):
 * authentication, ownership, strict query validation and tampering, through
 * the real guard, verifier, controller and exception filter. The PostgreSQL
 * path — including "stats equal the next combat's snapshot" and "a preview
 * writes nothing" — is covered in `test-integration/character-stats.int.test.ts`.
 */

interface StoredCharacter {
  readonly authUserId: string;
  readonly equipment: Equipment;
  readonly inventory: readonly OwnedItem[];
}

/** A read-only fake: the port has no write method, so neither does this. */
class InMemoryCharacterStats implements CharacterStatsRepository {
  readonly characters = new Map<string, StoredCharacter>();

  loadLoadout(
    authUserId: string,
    characterId: string,
    candidateItemId: string | null,
  ): Promise<CharacterLoadout | null> {
    const stored = this.characters.get(characterId);
    if (stored?.authUserId !== authUserId) return Promise.resolve(null);
    const owned = [
      ...Object.values(stored.equipment).flatMap((entry) => (entry === null ? [] : [entry])),
      ...stored.inventory,
    ];
    return Promise.resolve({
      level: 1,
      version: 11n,
      equipment: stored.equipment,
      candidate: owned.find((entry) => entry.item.id.toString() === candidateItemId) ?? null,
    });
  }
}

function owned(definitionId: string, affixes: readonly RolledAffix[] = []): OwnedItem {
  return {
    item: createItemInstance(
      {
        id: ItemInstanceId.parse(randomUUID()),
        definitionId: ItemDefinitionId.parse(definitionId),
        rarity: 'RARE',
        generationVersion: 1,
        affixes,
      },
      ITEM_CATALOG,
    ),
    createdAt: new Date('2026-09-29T10:00:00.000Z'),
  };
}

const flatDamage = (value: string): RolledAffix => ({
  id: randomUUID(),
  definitionId: 'damage_flat',
  stat: 'DAMAGE',
  operation: 'FLAT',
  value,
  position: 0,
});

let issuer: TestTokenIssuer;
let app: INestApplication;
let stats: InMemoryCharacterStats;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
});

beforeEach(async () => {
  const game = new InMemoryGameRepository();
  stats = new InMemoryCharacterStats();
  app = await createTestApp({
    issuer,
    players: game,
    combats: game,
    selections: game,
    characterStats: stats,
  });
});

afterEach(async () => {
  await app.close();
});

async function player() {
  const sub = randomUUID();
  const characterId = randomUUID();
  const swordA = owned('forged_iron_sword', [flatDamage('1e1')]);
  const swordB = owned('forged_iron_sword', [flatDamage('2e1')]);
  stats.characters.set(characterId, {
    authUserId: sub,
    equipment: {
      WEAPON: swordA,
      HELMET: null,
      CHEST: null,
      GLOVES: null,
      BOOTS: null,
      RING: null,
      AMULET: null,
    },
    inventory: [swordB],
  });
  return { token: await issuer.issue({ sub }), characterId, swordA, swordB };
}

function get(token: string | null, path: string) {
  const call = request(httpServer(app)).get(path);
  return token === null ? call : call.set('authorization', `Bearer ${token}`);
}

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}

describe('GET /player/characters/:characterId/stats', () => {
  it('returns the authoritative sheet and its sources without item identities', async () => {
    const { token, characterId, swordA } = await player();
    const response = await get(token, `/player/characters/${characterId}/stats`).expect(200);
    const body = characterStatsResponseSchema.parse(response.body);

    expect(body.characterVersion).toBe('11');
    expect(body.stats.base.damage).toBe('1e1');
    expect(body.stats.bonus.damage).toBe('1e1');
    expect(body.stats.effective.damage).toBe('2e1');
    expect(body.sources).toEqual([
      {
        stat: 'DAMAGE',
        operation: 'FLAT',
        value: '1e1',
        slot: 'WEAPON',
        itemDefinitionId: 'forged_iron_sword',
        itemNameKey: 'item.forged_iron_sword.name',
        itemRarity: 'RARE',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(swordA.item.id.toString());
    expect(JSON.stringify(body)).not.toContain(swordA.item.affixes[0]?.id);
  });

  it('requires a verified token', async () => {
    const { characterId } = await player();
    const response = await get(null, `/player/characters/${characterId}/stats`).expect(401);
    expectError(response.body, 'UNAUTHENTICATED');
  });

  it('answers another player’s character exactly like a missing one', async () => {
    const alice = await player();
    const bob = await player();
    for (const characterId of [bob.characterId, randomUUID()]) {
      const response = await get(alice.token, `/player/characters/${characterId}/stats`).expect(
        404,
      );
      expectError(response.body, 'NOT_FOUND');
    }
  });

  it('rejects a malformed character id', async () => {
    const { token } = await player();
    expectError(
      (await get(token, '/player/characters/abc/stats').expect(400)).body,
      'VALIDATION_FAILED',
    );
  });
});

describe('GET /player/characters/:characterId/stats/preview', () => {
  it('compares the candidate against the item it replaces', async () => {
    const { token, characterId, swordA, swordB } = await player();
    const response = await get(
      token,
      `/player/characters/${characterId}/stats/preview?equip=${swordB.item.id.toString()}`,
    ).expect(200);
    const body = statsPreviewResponseSchema.parse(response.body);

    expect(body.change).toMatchObject({
      kind: 'EQUIP',
      slot: 'WEAPON',
      item: { id: swordB.item.id.toString() },
      replaces: { id: swordA.item.id.toString() },
    });
    expect(body.unchanged).toBe(false);
    expect(body.current.effective.damage).toBe('2e1');
    expect(body.preview.effective.damage).toBe('3e1');
    expect(body.delta.damage).toBe('1e1');
  });

  it('previews an unequip by slot', async () => {
    const { token, characterId } = await player();
    const body = statsPreviewResponseSchema.parse(
      (
        await get(token, `/player/characters/${characterId}/stats/preview?unequip=WEAPON`).expect(
          200,
        )
      ).body,
    );
    expect(body.change.kind).toBe('UNEQUIP');
    expect(body.delta.damage).toBe('-1e1');
  });

  it('cannot preview another player’s item, even on the caller’s own character', async () => {
    const alice = await player();
    const bob = await player();
    for (const path of [
      `/player/characters/${alice.characterId}/stats/preview?equip=${bob.swordB.item.id.toString()}`,
      `/player/characters/${bob.characterId}/stats/preview?equip=${bob.swordB.item.id.toString()}`,
      `/player/characters/${alice.characterId}/stats/preview?equip=${randomUUID()}`,
    ]) {
      expectError((await get(alice.token, path).expect(404)).body, 'NOT_FOUND');
    }
  });

  it('accepts only the intent: no slot, rarity, affixes, stats, version or seed', async () => {
    const { token, characterId, swordB } = await player();
    const id = swordB.item.id.toString();
    const base = `/player/characters/${characterId}/stats/preview`;
    for (const query of [
      '',
      `?equip=${id}&slot=RING`,
      `?equip=${id}&rarity=MYTHIC`,
      `?equip=${id}&affixes=%5B%5D`,
      `?equip=${id}&damage=1e99`,
      `?equip=${id}&criticalChanceBp=10000`,
      `?equip=${id}&characterVersion=0`,
      `?equip=${id}&seed=abc`,
      `?equip=${id}&unequip=WEAPON`,
      `?equip=${id}&equip=${randomUUID()}`,
      '?equip=not-a-uuid',
      '?unequip=weapon',
    ]) {
      const response = await get(token, `${base}${query}`).expect(400);
      expectError(response.body, 'VALIDATION_FAILED');
      expect(JSON.stringify(response.body)).not.toContain('MYTHIC');
      expect(JSON.stringify(response.body)).not.toContain('1e99');
    }
  });

  it('requires a verified token', async () => {
    const { characterId, swordB } = await player();
    await get(
      null,
      `/player/characters/${characterId}/stats/preview?equip=${swordB.item.id.toString()}`,
    ).expect(401);
  });
});
