import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  characterStatsResponseSchema,
  combatResponseSchema,
  playerStateResponseSchema,
  statsPreviewResponseSchema,
  type CharacterStatValuesDto,
} from '@eternal-forge/contracts';
import {
  HugeNumber,
  applyCombatCaps,
  getGameRules,
  GAME_RULES_VERSION,
} from '@eternal-forge/game-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCharacterStatsRepository } from '../src/character-stats/infrastructure/prisma-character-stats.repository.js';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { PrismaInventoryRepository } from '../src/inventory/infrastructure/prisma-inventory.repository.js';
import { PrismaPlayerRepository } from '../src/player/infrastructure/prisma-player.repository.js';
import { PrismaStageSelectionRepository } from '../src/player/infrastructure/prisma-stage-selection.repository.js';
import {
  ManualClock,
  createTestApp,
  httpServer,
  sequentialSeeds,
} from '../test/support/create-test-app.js';
import { TestTokenIssuer } from '../test/support/token-issuer.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';

/**
 * Character stats and equipment previews against a real PostgreSQL
 * (ADR-030): HTTP → guard → controller → use case → Game Core → Prisma.
 *
 * The central claims are proved end to end: the stats a player reads are the
 * stats the next online combat snapshots (ADR-029), a preview is what the
 * equip actually produces, and a preview writes nothing.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let clock: ManualClock;
let app: INestApplication;

beforeAll(async () => {
  prisma = connectTestDatabase();
  issuer = await TestTokenIssuer.create();
});

afterAll(async () => {
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  await resetPlayerTables(prisma);
  clock = new ManualClock(new Date());
  app = await createTestApp({
    issuer,
    players: new PrismaPlayerRepository(prisma),
    combats: new PrismaCombatRepository(prisma),
    selections: new PrismaStageSelectionRepository(prisma),
    inventory: new PrismaInventoryRepository(prisma),
    characterStats: new PrismaCharacterStatsRepository(prisma),
    seeds: sequentialSeeds(`stats-${randomUUID().slice(0, 8)}`),
    clock,
  });
});

afterEach(async () => {
  await app.close();
});

interface Roll {
  readonly affixDefinitionId: string;
  readonly stat: string;
  readonly operation: string;
  readonly value: string;
}

const flatDamage = (value: string): Roll => ({
  affixDefinitionId: 'damage_flat',
  stat: 'DAMAGE',
  operation: 'FLAT',
  value,
});
const critChance = (value: string): Roll => ({
  affixDefinitionId: 'critical_chance_flat',
  stat: 'CRITICAL_CHANCE',
  operation: 'FLAT',
  value,
});

async function provisionedPlayer() {
  const token = await issuer.issue({ sub: randomUUID() });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  return { token, characterId: playerStateResponseSchema.parse(response.body).character.id };
}

/** Trusted fixture: an owned instance with persisted rolls, as a drop would create it. */
async function grantItem(characterId: string, definitionId: string, rolls: readonly Roll[]) {
  const row = await prisma.client.itemInstance.create({
    data: {
      characterId,
      definitionId,
      rarity: rolls.length === 0 ? 'COMMON' : 'EPIC',
      generationVersion: 1,
      affixes: {
        create: rolls.map((roll, position) => ({ ...roll, generationVersion: 1, position })),
      },
    },
  });
  return row.id;
}

function authed(token: string, method: 'get' | 'post', path: string) {
  return request(httpServer(app))[method](path).set('authorization', `Bearer ${token}`);
}

async function equip(token: string, characterId: string, itemInstanceId: string) {
  await authed(token, 'post', `/player/characters/${characterId}/equipment/equip`)
    .send({ itemInstanceId })
    .expect(200);
}

async function currentStats(token: string, characterId: string) {
  const response = await authed(token, 'get', `/player/characters/${characterId}/stats`).expect(
    200,
  );
  return characterStatsResponseSchema.parse(response.body);
}

async function previewEquip(token: string, characterId: string, itemInstanceId: string) {
  const response = await authed(
    token,
    'get',
    `/player/characters/${characterId}/stats/preview?equip=${itemInstanceId}`,
  ).expect(200);
  return statsPreviewResponseSchema.parse(response.body);
}

async function fightAndReadSnapshot(token: string, characterId: string) {
  const response = await authed(token, 'post', `/player/characters/${characterId}/combats`)
    .set('idempotency-key', randomUUID())
    .expect(201);
  const combat = combatResponseSchema.parse(response.body);
  const run = await prisma.client.combatRun.findUniqueOrThrow({ where: { id: combat.combat.id } });
  if (
    run.playerMaxHealthCoef === null ||
    run.playerMaxHealthExp === null ||
    run.playerDamageCoef === null ||
    run.playerDamageExp === null ||
    run.playerAttackSpeedBp === null ||
    run.playerCritChanceBp === null ||
    run.playerCritDamageBp === null
  ) {
    throw new Error('Expected a complete V3 combat stat snapshot.');
  }
  clock.advance(combat.combat.durationMs);
  const snapshot: CharacterStatValuesDto = {
    maxHealth: HugeNumber.fromParts(run.playerMaxHealthCoef, run.playerMaxHealthExp).toString(),
    damage: HugeNumber.fromParts(run.playerDamageCoef, run.playerDamageExp).toString(),
    attackSpeedBp: run.playerAttackSpeedBp,
    criticalChanceBp: run.playerCritChanceBp,
    criticalDamageBp: run.playerCritDamageBp,
  };
  return { snapshot, rulesVersion: run.rulesVersion };
}

async function persistedState(characterId: string) {
  const [character, equipment, items, affixes, combats] = await Promise.all([
    prisma.client.character.findUniqueOrThrow({ where: { id: characterId } }),
    prisma.client.characterEquipment.findMany({
      where: { characterId },
      orderBy: { slot: 'asc' },
    }),
    prisma.client.itemInstance.count({ where: { characterId } }),
    prisma.client.itemAffixRoll.count({ where: { itemInstance: { characterId } } }),
    prisma.client.combatRun.count({ where: { characterId } }),
  ]);
  return { version: character.version, level: character.level, equipment, items, affixes, combats };
}

describe('character stats against PostgreSQL — UI truth is combat truth', () => {
  it('returns exactly the five stats the next online combat snapshots', async () => {
    const { token, characterId } = await provisionedPlayer();
    await prisma.client.character.update({ where: { id: characterId }, data: { level: 37 } });
    const sword = await grantItem(characterId, 'forged_iron_sword', [
      flatDamage('2.3e1'),
      {
        affixDefinitionId: 'damage_percent',
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: '870',
      },
      {
        affixDefinitionId: 'attack_speed_percent',
        stat: 'ATTACK_SPEED',
        operation: 'ADDITIVE_PERCENT',
        value: '640',
      },
    ]);
    const amulet = await grantItem(characterId, 'forgeheart_amulet', [
      {
        affixDefinitionId: 'max_health_flat',
        stat: 'MAX_HEALTH',
        operation: 'FLAT',
        value: '7.7e1',
      },
      {
        affixDefinitionId: 'max_health_percent',
        stat: 'MAX_HEALTH',
        operation: 'ADDITIVE_PERCENT',
        value: '410',
      },
      critChance('330'),
      {
        affixDefinitionId: 'critical_damage_percent',
        stat: 'CRITICAL_DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: '990',
      },
    ]);
    const legacyRing = await prisma.client.itemInstance.create({
      data: { characterId, definitionId: 'runed_iron_ring', rarity: 'MYTHIC' },
    });
    for (const id of [sword, amulet, legacyRing.id]) await equip(token, characterId, id);

    const stats = await currentStats(token, characterId);
    const { snapshot, rulesVersion } = await fightAndReadSnapshot(token, characterId);

    expect(stats.level).toBe(37);
    expect(stats.rulesVersion).toBe(rulesVersion);
    expect(stats.stats.effective).toEqual(snapshot);
    // A real, non-trivial build: every stat moved off its base.
    for (const key of ['maxHealth', 'damage'] as const) {
      expect(stats.stats.bonus[key]).not.toBe('0');
    }
    expect(stats.stats.bonus.attackSpeedBp).toBeGreaterThan(0);
    expect(stats.stats.bonus.criticalChanceBp).toBe(330);
    expect(stats.stats.bonus.criticalDamageBp).toBeGreaterThan(0);
  });

  it('matches the snapshot with no equipment, and with a legacy zero-affix item', async () => {
    const { token, characterId } = await provisionedPlayer();
    const bare = await currentStats(token, characterId);
    expect(bare.stats.effective).toEqual((await fightAndReadSnapshot(token, characterId)).snapshot);
    expect(bare.sources).toEqual([]);

    const legacy = await prisma.client.itemInstance.create({
      data: { characterId, definitionId: 'emberguard_helm', rarity: 'LEGENDARY' },
    });
    await equip(token, characterId, legacy.id);
    const withLegacy = await currentStats(token, characterId);
    expect(withLegacy.stats.effective).toEqual(withLegacy.stats.base);
    expect(withLegacy.stats.effective).toEqual(
      (await fightAndReadSnapshot(token, characterId)).snapshot,
    );
  });
});

describe('equipment preview against PostgreSQL', () => {
  it('previews Sword B over Sword A without writing anything, and the equip matches it', async () => {
    const { token, characterId } = await provisionedPlayer();
    const swordA = await grantItem(characterId, 'forged_iron_sword', [flatDamage('1e1')]);
    const swordB = await grantItem(characterId, 'forged_iron_sword', [
      flatDamage('2e1'),
      critChance('250'),
    ]);
    await equip(token, characterId, swordA);
    const before = await persistedState(characterId);

    const preview = await previewEquip(token, characterId, swordB);
    expect(preview.change).toMatchObject({
      kind: 'EQUIP',
      slot: 'WEAPON',
      item: { id: swordB },
      replaces: { id: swordA },
    });
    expect(preview.characterVersion).toBe(before.version.toString());
    // Current reflects A; the preview reflects B alone — never A and B stacked.
    expect(preview.current.effective.damage).toBe('2e1');
    expect(preview.preview.effective.damage).toBe('3e1');
    expect(preview.delta).toEqual({
      maxHealth: '0',
      damage: '1e1',
      attackSpeedBp: 0,
      criticalChanceBp: 250,
      criticalDamageBp: 0,
    });
    // A query: equipment, version, items, rolls and combats are untouched.
    expect(await persistedState(characterId)).toEqual(before);

    await equip(token, characterId, swordB);
    const after = await currentStats(token, characterId);
    expect(after.stats).toEqual(preview.preview);
    expect(after.characterVersion).toBe((before.version + 1n).toString());
    const state = await persistedState(characterId);
    expect(state.equipment).toEqual([
      expect.objectContaining({ slot: 'WEAPON', itemInstanceId: swordB }),
    ]);
    expect(state.items).toBe(2);
  });

  it('previews an unequip, and the unequip matches it', async () => {
    const { token, characterId } = await provisionedPlayer();
    const ring = await grantItem(characterId, 'runed_iron_ring', [flatDamage('1.5e1')]);
    await equip(token, characterId, ring);
    const before = await persistedState(characterId);

    const response = await authed(
      token,
      'get',
      `/player/characters/${characterId}/stats/preview?unequip=RING`,
    ).expect(200);
    const preview = statsPreviewResponseSchema.parse(response.body);
    expect(preview.change).toMatchObject({ kind: 'UNEQUIP', slot: 'RING', item: { id: ring } });
    expect(preview.delta.damage).toBe('-1.5e1');
    expect(await persistedState(characterId)).toEqual(before);

    await authed(token, 'post', `/player/characters/${characterId}/equipment/unequip`)
      .send({ slot: 'RING' })
      .expect(200);
    expect((await currentStats(token, characterId)).stats).toEqual(preview.preview);
  });

  it('shows the capped Critical Chance a combat will use, not an uncapped sum', async () => {
    const { token, characterId } = await provisionedPlayer();
    const helm = await grantItem(characterId, 'emberguard_helm', [critChance('9500')]);
    const ring = await grantItem(characterId, 'runed_iron_ring', [
      critChance('400'),
      flatDamage('1e1'),
    ]);
    await equip(token, characterId, helm);

    const preview = await previewEquip(token, characterId, ring);
    expect(preview.current.effective.criticalChanceBp).toBe(10_000);
    expect(preview.preview.effective.criticalChanceBp).toBe(10_000);
    expect(preview.delta.criticalChanceBp).toBe(0);
    expect(preview.delta.damage).toBe('1e1');
    expect(preview.preview.atMaximum).toContain('CRITICAL_CHANCE');

    await equip(token, characterId, ring);
    const stats = await currentStats(token, characterId);
    expect(stats.stats).toEqual(preview.preview);
    expect(stats.stats.effective).toEqual(
      (await fightAndReadSnapshot(token, characterId)).snapshot,
    );
  });

  it('applies the combat attack-speed cap: stats are the capped values combat fights with', async () => {
    const { token, characterId } = await provisionedPlayer();
    const boots = await grantItem(characterId, 'cinderwalk_boots', [
      {
        affixDefinitionId: 'attack_speed_percent',
        stat: 'ATTACK_SPEED',
        operation: 'ADDITIVE_PERCENT',
        value: '95000',
      },
    ]);
    const gloves = await grantItem(characterId, 'smiths_gauntlets', [
      {
        affixDefinitionId: 'attack_speed_percent',
        stat: 'ATTACK_SPEED',
        operation: 'ADDITIVE_PERCENT',
        value: '10000',
      },
    ]);
    await equip(token, characterId, boots);
    const preview = await previewEquip(token, characterId, gloves);
    const cap = getGameRules(GAME_RULES_VERSION).combat.maxAttackSpeedBp;
    // Boots alone resolve to 105,000 bp, already above the 100,000 cap.
    expect(preview.current.effective.attackSpeedBp).toBe(cap);
    expect(preview.preview.effective.attackSpeedBp).toBe(cap);
    expect(preview.delta.attackSpeedBp).toBe(0);
    expect(preview.preview.atMaximum).toContain('ATTACK_SPEED');

    await equip(token, characterId, gloves);
    const stats = await currentStats(token, characterId);
    const { snapshot } = await fightAndReadSnapshot(token, characterId);
    // The snapshot records the resolved input (115,000); combat caps it, and
    // the character sheet shows the capped value combat actually uses.
    expect(snapshot.attackSpeedBp).toBe(115_000);
    const capped = applyCombatCaps(
      {
        maxHealth: HugeNumber.parse(snapshot.maxHealth),
        damage: HugeNumber.parse(snapshot.damage),
        attackSpeedBp: snapshot.attackSpeedBp,
        critChanceBp: snapshot.criticalChanceBp,
        critDamageBp: snapshot.criticalDamageBp,
      },
      getGameRules(GAME_RULES_VERSION).combat,
    );
    expect(stats.stats.effective.attackSpeedBp).toBe(capped.attackSpeedBp);
    expect(stats.stats.effective.criticalChanceBp).toBe(capped.critChanceBp);
    expect(stats.stats.effective.damage).toBe(snapshot.damage);
    expect(stats.stats.effective.maxHealth).toBe(snapshot.maxHealth);
  });

  it('marks an already-equipped item unchanged and a Common candidate as no stat change', async () => {
    const { token, characterId } = await provisionedPlayer();
    const sword = await grantItem(characterId, 'forged_iron_sword', [flatDamage('2e1')]);
    const commonHelm = await grantItem(characterId, 'emberguard_helm', []);
    await equip(token, characterId, sword);

    const same = await previewEquip(token, characterId, sword);
    expect(same.unchanged).toBe(true);
    expect(same.change).toMatchObject({ kind: 'EQUIP', replaces: null });
    expect(same.delta.damage).toBe('0');

    const common = await previewEquip(token, characterId, commonHelm);
    expect(common.unchanged).toBe(false);
    expect(common.preview.effective).toEqual(common.current.effective);
  });

  it('never previews another player’s item: 404 through either character', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();
    const bobsSword = await grantItem(bob.characterId, 'forged_iron_sword', [flatDamage('2.5e1')]);
    const bobBefore = await persistedState(bob.characterId);

    for (const characterId of [alice.characterId, bob.characterId]) {
      const response = await authed(
        alice.token,
        'get',
        `/player/characters/${characterId}/stats/preview?equip=${bobsSword}`,
      ).expect(404);
      expect(apiErrorResponseSchema.parse(response.body).code).toBe('NOT_FOUND');
    }
    await authed(alice.token, 'get', `/player/characters/${bob.characterId}/stats`).expect(404);
    expect(await persistedState(bob.characterId)).toEqual(bobBefore);
  });

  it('races previews against an equip: the equip wins alone and nothing else is written', async () => {
    const { token, characterId } = await provisionedPlayer();
    const swordA = await grantItem(characterId, 'forged_iron_sword', [flatDamage('1e1')]);
    const swordB = await grantItem(characterId, 'forged_iron_sword', [flatDamage('2e1')]);
    await equip(token, characterId, swordA);
    const before = await persistedState(characterId);

    const previews = Array.from({ length: 12 }, () =>
      authed(token, 'get', `/player/characters/${characterId}/stats/preview?equip=${swordB}`),
    );
    const [equipResponse, ...previewResponses] = await Promise.all([
      authed(token, 'post', `/player/characters/${characterId}/equipment/equip`).send({
        itemInstanceId: swordB,
      }),
      ...previews,
    ]);
    expect(equipResponse.status).toBe(200);
    for (const response of previewResponses) {
      expect(response.status).toBe(200);
      const preview = statsPreviewResponseSchema.parse(response.body);
      // Each preview describes one coherent state it read: before the equip
      // (A worn, B would add 10) or after it (B already worn, unchanged).
      if (preview.unchanged) {
        expect(preview.current.effective.damage).toBe('3e1');
        expect(preview.characterVersion).toBe((before.version + 1n).toString());
      } else {
        expect(preview.current.effective.damage).toBe('2e1');
        expect(preview.preview.effective.damage).toBe('3e1');
        expect(preview.characterVersion).toBe(before.version.toString());
      }
    }
    const after = await persistedState(characterId);
    expect(after.version).toBe(before.version + 1n);
    expect(after.equipment).toEqual([
      expect.objectContaining({ slot: 'WEAPON', itemInstanceId: swordB }),
    ]);
    expect(after.combats).toBe(0);
    expect(after.items).toBe(before.items);
    expect(after.affixes).toBe(before.affixes);
  });
});
