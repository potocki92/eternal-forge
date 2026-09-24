import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  combatResponseSchema,
  playerStateResponseSchema,
} from '@eternal-forge/contracts';
import {
  HugeNumber,
  INITIAL_STAGE_PROGRESS,
  StageNumber,
  calculateStageRewards,
  getGameRules,
  resolveStage,
} from '@eternal-forge/game-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
import type { CombatSeedSource } from '../src/combat/application/ports/combat-seed-source.port.js';
import { PrismaInventoryRepository } from '../src/inventory/infrastructure/prisma-inventory.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
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
 * The combat transaction against a real PostgreSQL (ADR-019): HTTP → guard →
 * controller → use case → Game Core → Prisma → PostgreSQL. Concurrency is
 * exercised through real connections, where the row lock and the version
 * check — not an in-process mutex — decide the winner.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let clock: ManualClock;
let app: INestApplication;
const extraApps: INestApplication[] = [];

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
  app = await newApiInstance();
});

afterEach(async () => {
  await Promise.all([app, ...extraApps.splice(0)].map((instance) => instance.close()));
});

/** One more API process sharing the database, as a second replica would. */
async function newApiInstance(seeds?: CombatSeedSource): Promise<INestApplication> {
  return createTestApp({
    issuer,
    players: new PrismaPlayerRepository(prisma),
    combats: new PrismaCombatRepository(prisma),
    selections: new PrismaStageSelectionRepository(prisma),
    seeds: seeds ?? sequentialSeeds(`int-${randomUUID().slice(0, 8)}`),
    clock,
  });
}

async function useFixedSeed(seed: string): Promise<void> {
  await app.close();
  app = await newApiInstance({ next: () => seed });
}

async function provisionedPlayer(instance: INestApplication = app) {
  const token = await issuer.issue({ sub: randomUUID() });
  const response = await request(httpServer(instance))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  return { token, characterId: playerStateResponseSchema.parse(response.body).character.id };
}

function fight(
  token: string,
  characterId: string,
  key: string = randomUUID(),
  instance: INestApplication = app,
) {
  return request(httpServer(instance))
    .post(`/player/characters/${characterId}/combats`)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', key);
}

async function characterRow(characterId: string) {
  return prisma.client.character.findUniqueOrThrow({ where: { id: characterId } });
}

function gold(row: { goldCoef: bigint; goldExp: number }): HugeNumber {
  return HugeNumber.fromParts(row.goldCoef, row.goldExp);
}

/**
 * Puts a character on a stage with some gold, as a fixture: pushing its
 * record, every earlier stage cleared.
 */
async function placeCharacter(characterId: string, stage: bigint, goldAmount = 41): Promise<void> {
  const parts = HugeNumber.fromNumber(goldAmount).toParts();
  await prisma.client.character.update({
    where: { id: characterId },
    data: {
      currentStage: stage,
      highestStageReached: stage,
      highestStageCleared: stage > 1n ? stage - 1n : null,
      goldCoef: parts.coefficient,
      goldExp: parts.exponent,
    },
  });
}

/** `current / highestReached / highestCleared` of a row, as in ADR-020. */
function stagesOf(row: {
  currentStage: bigint;
  highestStageReached: bigint;
  highestStageCleared: bigint | null;
}): string {
  return `${row.currentStage.toString()} / ${row.highestStageReached.toString()} / ${row.highestStageCleared?.toString() ?? 'null'}`;
}

describe('combat against PostgreSQL — the loop', () => {
  it('token → combat → persistence → response', async () => {
    const { token, characterId } = await provisionedPlayer();

    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    const row = await characterRow(characterId);
    const runs = await prisma.client.combatRun.findMany({ where: { characterId } });
    expect(stagesOf(row)).toBe('2 / 2 / 1');
    expect(row.version).toBe(1n);
    expect(gold(row).toString()).toBe(body.after.gold);
    expect(row.nextCombatAt.getTime()).toBe(clock.now().getTime() + body.combat.durationMs);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: body.combat.id,
      rulesVersion: 2,
      stage: 1n,
      highestStageReachedBefore: 1n,
      highestStageClearedBefore: null,
      characterLevel: 1,
      outcome: 'WIN',
      endReason: 'ENEMY_DEFEATED',
      durationMs: body.combat.durationMs,
    });
    expect(runs[0]?.seed).toMatch(/^int-[0-9a-f]{8}-1$/u);
  });

  it('keeps progression across a fresh API process (a browser refresh)', async () => {
    const { token, characterId } = await provisionedPlayer();
    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    const other = await newApiInstance();
    extraApps.push(other);
    const state = playerStateResponseSchema.parse(
      (
        await request(httpServer(other))
          .get('/player/state')
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );

    expect(state.character).toEqual(body.character);
    expect(state.progression).toEqual(body.progression);
  });

  it('plays a long session: every reward lands once and the ledger reconciles', async () => {
    const { token, characterId } = await provisionedPlayer();
    const rules = getGameRules(2);
    let expectedStage = StageNumber.FIRST;
    let reached = 1n;
    let cleared = 0n;

    for (let fightNumber = 0; fightNumber < 30; fightNumber += 1) {
      const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
      expect(body.combat.stage.number).toBe(expectedStage.toString());
      // The records never go down, whatever the outcome.
      expect(BigInt(body.after.highestStageReached)).toBeGreaterThanOrEqual(reached);
      expect(BigInt(body.after.highestStageCleared ?? '0')).toBeGreaterThanOrEqual(cleared);
      reached = BigInt(body.after.highestStageReached);
      cleared = BigInt(body.after.highestStageCleared ?? '0');
      expectedStage = StageNumber.parse(body.after.currentStage);
      clock.advance(body.combat.durationMs);
    }

    const row = await characterRow(characterId);
    const runs = await prisma.client.combatRun.findMany({
      where: { characterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(runs).toHaveLength(30);
    expect(row.version).toBe(30n);
    expect(row.currentStage).toBe(expectedStage.toBigInt());
    expect(row.highestStageReached).toBe(reached);
    expect(row.highestStageCleared).toBe(cleared);
    // The highest stage cleared is exactly the highest stage with a recorded win.
    const wins = runs.filter((run) => run.outcome === 'WIN').map((run) => run.stage);
    expect(wins.reduce((max, stage) => (stage > max ? stage : max), 0n)).toBe(cleared);

    // Replaying the ledger through HugeNumber (ADR-013) reproduces the balance.
    const ledgerGold = runs.reduce(
      (sum, run) => sum.add(HugeNumber.fromParts(run.rewardGoldCoef, run.rewardGoldExp)),
      HugeNumber.ZERO,
    );
    expect(gold(row).eq(ledgerGold)).toBe(true);
    // Every row pays exactly what Game Core says its stage is worth — the
    // stage kind (boss or not) comes from the rule set, not from this test.
    for (const run of runs) {
      const paid = HugeNumber.fromParts(run.rewardGoldCoef, run.rewardGoldExp);
      const stage = resolveStage(StageNumber.of(run.stage), rules.stages);
      const expected =
        run.outcome === 'WIN' ? calculateStageRewards(stage, rules.rewards).gold : HugeNumber.ZERO;
      expect(paid.eq(expected)).toBe(true);
    }
  });

  it('replays a stored combat from the database with an identical body', async () => {
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();
    const first = combatResponseSchema.parse(
      (await fight(token, characterId, key).expect(201)).body,
    );
    clock.advance(first.combat.durationMs);
    await fight(token, characterId).expect(201);

    const replay = combatResponseSchema.parse(
      (await fight(token, characterId, key).expect(200)).body,
    );

    expect({ ...replay, serverTime: first.serverTime }).toEqual(first);
    expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(2);
  });

  it('a boss defeat on stage 10: back to 9, records kept, the run keeps stage 10', async () => {
    const { token, characterId } = await provisionedPlayer();
    await placeCharacter(characterId, 10n);

    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    expect(body.combat.stage).toEqual({ number: '10', kind: 'BOSS' });
    expect(body.combat.outcome).toBe('LOSS');
    expect(body.progression).toMatchObject({
      currentStage: '9',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
    const row = await characterRow(characterId);
    expect(stagesOf(row)).toBe('9 / 10 / 9');
    const run = await prisma.client.combatRun.findFirstOrThrow({ where: { characterId } });
    expect(run).toMatchObject({
      stage: 10n,
      highestStageReachedBefore: 10n,
      highestStageClearedBefore: 9n,
    });
  });

  it('a boss defeat pays nothing and falls back one stage, exactly', async () => {
    const { token, characterId } = await provisionedPlayer();
    await placeCharacter(characterId, 4_000_000_000n);

    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    expect(body.combat.stage).toEqual({ number: '4000000000', kind: 'BOSS' });
    expect(body.combat.outcome).toBe('LOSS');
    const row = await characterRow(characterId);
    expect(stagesOf(row)).toBe('3999999999 / 4000000000 / 3999999999');
    expect(gold(row).eq(HugeNumber.fromNumber(41))).toBe(true);
  });

  it('a stage too deep for the rule set is 409 STAGE_NOT_PLAYABLE and writes nothing', async () => {
    const { token, characterId } = await provisionedPlayer();
    await placeCharacter(characterId, 2n ** 53n + 1n);
    const before = await characterRow(characterId);

    const response = await fight(token, characterId).expect(409);

    expect(apiErrorResponseSchema.parse(response.body).code).toBe('STAGE_NOT_PLAYABLE');
    expect(await characterRow(characterId)).toEqual(before);
    expect(await prisma.client.combatRun.count()).toBe(0);
  });
});

describe('combat against PostgreSQL — item rewards', () => {
  it('atomically awards a deterministic item that is immediately visible in inventory', async () => {
    await useFixedSeed('loot-25');
    const { token, characterId } = await provisionedPlayer();

    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    expect(body.combat.rewards.item).toMatchObject({
      definitionId: 'ashsteel_cuirass',
      rarity: 'COMMON',
      slot: 'CHEST',
      nameKey: 'item.ashsteel_cuirass.name',
    });
    const item = await prisma.client.itemInstance.findFirstOrThrow({ where: { characterId } });
    expect(item.id).toBe(body.combat.rewards.item?.id);
    expect(item.combatRunId).toBe(body.combat.id);
    expect(await prisma.client.characterEquipment.count({ where: { characterId } })).toBe(0);

    const profile = await prisma.client.character.findUniqueOrThrow({
      where: { id: characterId },
      include: { profile: true },
    });
    const inventory = await new PrismaInventoryRepository(prisma).loadOwned(
      profile.profile.authUserId,
      characterId,
    );
    expect(inventory?.items[0]?.item.id.toString()).toBe(item.id);
  });

  it('persists normal progression and no item for a deterministic no-drop victory', async () => {
    await useFixedSeed('loot-0');
    const { token, characterId } = await provisionedPlayer();
    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    expect(body.combat.outcome).toBe('WIN');
    expect(body.combat.rewards.item).toBeNull();
    expect(await prisma.client.itemInstance.count({ where: { characterId } })).toBe(0);
    expect(stagesOf(await characterRow(characterId))).toBe('2 / 2 / 1');
  });

  it('allows different combats to award separate instances with the same definition and rarity', async () => {
    const seeds = ['loot-25', 'two-6'];
    await app.close();
    app = await newApiInstance({ next: () => seeds.shift() ?? 'unexpected' });
    const { token, characterId } = await provisionedPlayer();
    const first = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    clock.advance(first.combat.durationMs);
    const second = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    expect(first.combat.rewards.item).toMatchObject({
      definitionId: 'ashsteel_cuirass',
      rarity: 'COMMON',
    });
    expect(second.combat.rewards.item).toMatchObject({
      definitionId: 'ashsteel_cuirass',
      rarity: 'COMMON',
    });
    expect(second.combat.rewards.item?.id).not.toBe(first.combat.rewards.item?.id);
    expect(await prisma.client.itemInstance.count({ where: { characterId } })).toBe(2);
  });

  it('rolls progression and the combat record back when item persistence fails, then retries safely', async () => {
    await useFixedSeed('loot-25');
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();
    const before = await characterRow(characterId);
    await prisma.client.$executeRawUnsafe(`
      CREATE FUNCTION reject_test_item_drop() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced item failure'; END; $$;
      CREATE TRIGGER reject_test_item_drop BEFORE INSERT ON item_instances
      FOR EACH ROW EXECUTE FUNCTION reject_test_item_drop();
    `);
    try {
      await fight(token, characterId, key).expect(500);
      expect(await characterRow(characterId)).toEqual(before);
      expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(0);
      expect(await prisma.client.itemInstance.count({ where: { characterId } })).toBe(0);
    } finally {
      await prisma.client.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS reject_test_item_drop ON item_instances;
        DROP FUNCTION IF EXISTS reject_test_item_drop();
      `);
    }
    const retry = combatResponseSchema.parse(
      (await fight(token, characterId, key).expect(201)).body,
    );
    expect(retry.combat.rewards.item).not.toBeNull();
    expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(1);
    expect(await prisma.client.itemInstance.count({ where: { characterId } })).toBe(1);
  });
});

describe('combat against PostgreSQL — concurrency', () => {
  const BURST = 25;

  it(`${BURST} simultaneous combats on stage 9: one combat, one reward, one stage`, async () => {
    const { token, characterId } = await provisionedPlayer();
    await placeCharacter(characterId, 9n);
    const reward = calculateStageRewards(
      { number: StageNumber.of(9), kind: 'REGULAR' },
      getGameRules(1).rewards,
    );

    const responses = await Promise.all(
      Array.from({ length: BURST }, () => fight(token, characterId)),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(BURST - 1).fill(409)]);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(apiErrorResponseSchema.parse(response.body).code).toBe('COMBAT_NOT_READY');
    }
    const row = await characterRow(characterId);
    expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(1);
    expect(row.version).toBe(1n);
    expect(stagesOf(row)).toBe('10 / 10 / 9');
    expect(gold(row).eq(HugeNumber.fromNumber(41).add(reward.gold))).toBe(true);
  });

  it(`${BURST} simultaneous retries of one request: one combat, every retry gets it`, async () => {
    await useFixedSeed('loot-25');
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: BURST }, () => fight(token, characterId, key)),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(BURST - 1);
    const ids = new Set(
      responses.map((response) => combatResponseSchema.parse(response.body).combat.id),
    );
    expect(ids.size).toBe(1);
    expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(1);
    expect(await prisma.client.itemInstance.count({ where: { characterId } })).toBe(1);
    const awardedIds = new Set(
      responses.map(
        (response) => combatResponseSchema.parse(response.body).combat.rewards.item?.id,
      ),
    );
    expect(awardedIds.size).toBe(1);
    // The records moved exactly once.
    expect(stagesOf(await characterRow(characterId))).toBe('2 / 2 / 1');
  });

  it('many intents, each retried, across two API instances: still exactly one combat', async () => {
    const { token, characterId } = await provisionedPlayer();
    const second = await newApiInstance();
    extraApps.push(second);
    const keys = Array.from({ length: 8 }, () => randomUUID());

    const responses = await Promise.all(
      keys.flatMap((key, index) =>
        Array.from({ length: 3 }, (_, attempt) =>
          fight(token, characterId, key, (index + attempt) % 2 === 0 ? app : second),
        ),
      ),
    );

    const run = await prisma.client.combatRun.findFirstOrThrow({ where: { characterId } });
    expect(await prisma.client.combatRun.count({ where: { characterId } })).toBe(1);
    for (const response of responses) {
      if (response.status === 409) {
        continue;
      }
      expect([200, 201]).toContain(response.status);
      expect(combatResponseSchema.parse(response.body).combat.id).toBe(run.id);
    }
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect((await characterRow(characterId)).version).toBe(1n);
  });

  it('isolates characters: concurrent combats of different players all succeed', async () => {
    const players = await Promise.all(Array.from({ length: 10 }, () => provisionedPlayer()));

    const responses = await Promise.all(
      players.map(({ token, characterId }) => fight(token, characterId)),
    );

    expect(responses.map((response) => response.status)).toEqual(Array<number>(10).fill(201));
    expect(await prisma.client.combatRun.count()).toBe(10);
  });
});

describe('PrismaCombatRepository — conditional commit', () => {
  it('writes nothing when the character changed since it was read', async () => {
    const { token, characterId } = await provisionedPlayer();
    const sub = (await characterRow(characterId)).profileId;
    const profile = await prisma.client.profile.findUniqueOrThrow({ where: { id: sub } });
    const repository = new PrismaCombatRepository(prisma);
    const target = await repository.loadTarget(profile.authUserId, characterId, randomUUID());
    expect(target).not.toBeNull();

    // Someone else wins in between.
    await fight(token, characterId).expect(201);

    const result = await repository.commit({
      authUserId: profile.authUserId,
      characterId,
      expectedVersion: target?.version ?? -1n,
      progress: {
        level: 99,
        experience: HugeNumber.ZERO,
        gold: HugeNumber.fromDecimal('1e30'),
        stages: {
          current: StageNumber.of(500),
          highestReached: StageNumber.of(500),
          highestCleared: StageNumber.of(499),
        },
      },
      nextCombatAt: new Date(),
      itemDrop: null,
      run: {
        characterId,
        idempotencyKey: randomUUID(),
        rulesVersion: 1,
        seed: 'stale',
        before: {
          level: 1,
          experience: HugeNumber.ZERO,
          gold: HugeNumber.ZERO,
          stages: INITIAL_STAGE_PROGRESS,
        },
        stageMode: 'PROGRESS',
        outcome: 'WIN',
        endReason: 'ENEMY_DEFEATED',
        durationMs: 1,
        rewards: { gold: HugeNumber.fromDecimal('1e30'), experience: HugeNumber.ZERO },
        resolvedAt: new Date(),
      },
    });

    expect(result).toEqual({ kind: 'conflict' });
    const row = await characterRow(characterId);
    expect(row.level).toBe(1);
    expect(stagesOf(row)).toBe('2 / 2 / 1');
    expect(await prisma.client.combatRun.count({ where: { seed: 'stale' } })).toBe(0);
  });

  it('refuses to write another player’s character even with the right version', async () => {
    const { characterId } = await provisionedPlayer();
    const repository = new PrismaCombatRepository(prisma);

    const result = await repository.commit({
      authUserId: randomUUID(),
      characterId,
      expectedVersion: 0n,
      progress: {
        level: 1,
        experience: HugeNumber.ZERO,
        gold: HugeNumber.fromNumber(1),
        stages: {
          current: StageNumber.of(2),
          highestReached: StageNumber.of(2),
          highestCleared: StageNumber.FIRST,
        },
      },
      nextCombatAt: new Date(),
      itemDrop: null,
      run: {
        characterId,
        idempotencyKey: randomUUID(),
        rulesVersion: 1,
        seed: 'intruder',
        before: {
          level: 1,
          experience: HugeNumber.ZERO,
          gold: HugeNumber.ZERO,
          stages: INITIAL_STAGE_PROGRESS,
        },
        stageMode: 'PROGRESS',
        outcome: 'WIN',
        endReason: 'ENEMY_DEFEATED',
        durationMs: 1,
        rewards: { gold: HugeNumber.fromNumber(1), experience: HugeNumber.ZERO },
        resolvedAt: new Date(),
      },
    });

    expect(result).toEqual({ kind: 'conflict' });
    expect((await characterRow(characterId)).version).toBe(0n);
  });
});

describe('schema constraints — progression and the combat ledger', () => {
  async function insertRun(characterId: string, overrides: string): Promise<void> {
    await prisma.client.$executeRawUnsafe(`
      INSERT INTO combat_runs (character_id, idempotency_key, rules_version, seed, stage,
        highest_stage_reached_before, stage_mode, character_level, experience_before_coef,
        experience_before_exp, gold_before_coef,
        gold_before_exp, outcome, end_reason, duration_ms, reward_gold_coef, reward_gold_exp,
        reward_experience_coef, reward_experience_exp)
      SELECT '${characterId}', gen_random_uuid(), 1, 'seed', 1, 1, 'PROGRESS', 1, 0, -2147483648, 0,
        -2147483648, v.outcome::combat_outcome, v.end_reason::combat_end_reason, 1000,
        v.gold_coef, v.gold_exp, 0, -2147483648
      FROM (VALUES ${overrides}) AS v(outcome, end_reason, gold_coef, gold_exp)`);
  }

  it('accepts a well formed win', async () => {
    const { characterId } = await provisionedPlayer();
    await insertRun(characterId, `('WIN', 'ENEMY_DEFEATED', 500000000000000000, 0)`);
    expect(await prisma.client.combatRun.count()).toBe(1);
  });

  it.each([
    ['a loss that pays', `('LOSS', 'PLAYER_DEFEATED', 500000000000000000, 0)`],
    ['a win that ended in defeat', `('WIN', 'PLAYER_DEFEATED', 0, -2147483648)`],
    ['a loss by enemy defeat', `('LOSS', 'ENEMY_DEFEATED', 0, -2147483648)`],
    ['a fractional reward (1.5)', `('WIN', 'ENEMY_DEFEATED', 150000000000000000, 0)`],
    ['a non-normalised reward', `('WIN', 'ENEMY_DEFEATED', 5, 0)`],
    ['a negative reward', `('WIN', 'ENEMY_DEFEATED', -500000000000000000, 0)`],
  ])('rejects %s', async (_label, values) => {
    const { characterId } = await provisionedPlayer();
    await expect(insertRun(characterId, values)).rejects.toThrow();
  });

  it.each([
    ['negative gold', { goldCoef: -500000000000000000n, goldExp: 0 }],
    ['fractional gold', { goldCoef: 250000000000000000n, goldExp: -1 }],
    ['zero with a real exponent', { goldCoef: 0n, goldExp: 3 }],
    ['negative experience', { experienceCoef: -100000000000000000n, experienceExp: 0 }],
    ['a negative version', { version: -1n }],
    ['a current stage beyond the highest reached', { currentStage: 2n }],
    ['a clear beyond the highest reached', { highestStageCleared: 2n }],
    ['highest stage reached 0', { currentStage: 0n, highestStageReached: 0n }],
    ['highest stage cleared 0', { highestStageCleared: 0n }],
  ])('rejects a character with %s', async (_label, data) => {
    const { characterId } = await provisionedPlayer();
    await expect(
      prisma.client.character.update({ where: { id: characterId }, data }),
    ).rejects.toThrow();
  });

  it('stores gold far beyond 2^53 exactly as its HugeNumber parts', async () => {
    const { characterId } = await provisionedPlayer();
    const huge = HugeNumber.fromDecimal('123456789012345678e40');
    const parts = huge.toParts();
    await prisma.client.character.update({
      where: { id: characterId },
      data: { goldCoef: parts.coefficient, goldExp: parts.exponent },
    });

    expect(gold(await characterRow(characterId)).eq(huge)).toBe(true);
  });

  it('deletes combat history with its character', async () => {
    const { token, characterId } = await provisionedPlayer();
    await fight(token, characterId).expect(201);

    await prisma.client.character.delete({ where: { id: characterId } });

    expect(await prisma.client.combatRun.count()).toBe(0);
  });
});

describe('schema constraints — stage records of a combat', () => {
  async function insertRunOn(characterId: string, stage: number, reached: number, cleared: string) {
    await prisma.client.$executeRawUnsafe(`
      INSERT INTO combat_runs (character_id, idempotency_key, rules_version, seed, stage,
        highest_stage_reached_before, highest_stage_cleared_before, stage_mode, character_level,
        experience_before_coef, experience_before_exp, gold_before_coef, gold_before_exp,
        outcome, end_reason, duration_ms, reward_gold_coef, reward_gold_exp,
        reward_experience_coef, reward_experience_exp)
      VALUES ('${characterId}', gen_random_uuid(), 1, 'seed', ${String(stage)}, ${String(reached)},
        ${cleared}, 'FARM', 1, 0, -2147483648, 0, -2147483648, 'LOSS', 'PLAYER_DEFEATED', 1000,
        0, -2147483648, 0, -2147483648)`);
  }

  it('accepts a farm combat below the records', async () => {
    const { characterId } = await provisionedPlayer();
    await insertRunOn(characterId, 3, 10, '9');
    expect(await prisma.client.combatRun.count()).toBe(1);
  });

  it.each([
    ['a stage fought beyond the highest reached', 11, 10, '9'],
    ['a clear beyond the highest reached', 9, 10, '11'],
    ['a clear of stage 0', 1, 1, '0'],
  ])('rejects %s', async (_label, stage, reached, cleared) => {
    const { characterId } = await provisionedPlayer();
    await expect(insertRunOn(characterId, stage, reached, cleared)).rejects.toThrow();
  });
});

describe('row level security — combat_runs', () => {
  it('is enabled and denies a non-owner role by default', async () => {
    const { token, characterId } = await provisionedPlayer();
    await fight(token, characterId).expect(201);
    const role = 'ef_rls_combat_probe';

    const [enabled] = await prisma.client.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'combat_runs'`,
    );
    const visible = await prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT SELECT ON combat_runs TO ${role}`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      const [runs] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) FROM combat_runs',
      );
      await tx.$executeRawUnsafe('RESET ROLE');
      await tx.$executeRawUnsafe(`REVOKE ALL ON combat_runs FROM ${role}`);
      await tx.$executeRawUnsafe(`DROP ROLE ${role}`);
      return runs?.count;
    });

    expect(enabled?.relrowsecurity).toBe(true);
    expect(visible).toBe(0n);
  });
});
