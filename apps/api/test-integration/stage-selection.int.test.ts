import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  combatResponseSchema,
  playerStateResponseSchema,
  stageSelectionResponseSchema,
} from '@eternal-forge/contracts';
import { StageNumber } from '@eternal-forge/game-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
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
 * Stage selection and farming against a real PostgreSQL (ADR-021): the
 * selection's conditional write, its interplay with the combat transaction,
 * persistence across API processes and the schema's constraints.
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

async function newApiInstance(): Promise<INestApplication> {
  return createTestApp({
    issuer,
    players: new PrismaPlayerRepository(prisma),
    combats: new PrismaCombatRepository(prisma),
    selections: new PrismaStageSelectionRepository(prisma),
    seeds: sequentialSeeds(`sel-${randomUUID().slice(0, 8)}`),
    clock,
  });
}

async function provisionedPlayer(sub: string = randomUUID()) {
  const token = await issuer.issue({ sub });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  return { token, characterId: playerStateResponseSchema.parse(response.body).character.id };
}

/** The records ADR-021's examples use, on a hero strong enough to farm them. */
async function place(
  characterId: string,
  stages: { current: bigint; reached: bigint; cleared: bigint | null },
  level = 400,
): Promise<void> {
  await prisma.client.character.update({
    where: { id: characterId },
    data: {
      level,
      currentStage: stages.current,
      highestStageReached: stages.reached,
      highestStageCleared: stages.cleared,
    },
  });
}

function select(token: string, characterId: string, body: unknown, instance = app) {
  return request(httpServer(instance))
    .put(`/player/characters/${characterId}/stage-selection`)
    .set('authorization', `Bearer ${token}`)
    .send(body as object);
}

function fight(token: string, characterId: string, instance = app, key: string = randomUUID()) {
  return request(httpServer(instance))
    .post(`/player/characters/${characterId}/combats`)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', key);
}

async function row(characterId: string) {
  return prisma.client.character.findUniqueOrThrow({ where: { id: characterId } });
}

function view(value: {
  stageMode: string;
  currentStage: bigint;
  highestStageReached: bigint;
  highestStageCleared: bigint | null;
}): string {
  return `${value.stageMode} ${value.currentStage.toString()} / ${value.highestStageReached.toString()} / ${value.highestStageCleared?.toString() ?? 'null'}`;
}

describe('stage selection against PostgreSQL — persistence', () => {
  it('a new character climbs from stage 1', async () => {
    const { characterId } = await provisionedPlayer();
    expect(view(await row(characterId))).toBe('PROGRESS 1 / 1 / null');
  });

  it('persists the selection and serves it to a fresh API process (refresh, relogin, restart)', async () => {
    const sub = randomUUID();
    const { token, characterId } = await provisionedPlayer(sub);
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n });

    await select(token, characterId, { mode: 'FARM', stage: '4' }).expect(200);
    await app.close();
    app = await newApiInstance();
    // A new session: a different token for the same account.
    const relogin = await issuer.issue({ sub });

    const state = playerStateResponseSchema.parse(
      (
        await request(httpServer(app))
          .get('/player/state')
          .set('authorization', `Bearer ${relogin}`)
          .expect(200)
      ).body,
    );
    expect(state.progression).toMatchObject({
      stageMode: 'FARM',
      currentStage: '4',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
    expect(view(await row(characterId))).toBe('FARM 4 / 10 / 9');
  });

  it('stores and serves a farm stage beyond 2^53 exactly', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, {
      current: 1n,
      reached: 9_007_199_254_740_995n,
      cleared: 9_007_199_254_740_994n,
    });

    const body = stageSelectionResponseSchema.parse(
      (await select(token, characterId, { mode: 'FARM', stage: '9007199254740993' }).expect(200))
        .body,
    );

    expect(body.progression.currentStage).toBe('9007199254740993');
    expect((await row(characterId)).currentStage).toBe(9_007_199_254_740_993n);
    // One past the frontier: equal to it as a double, locked as an integer.
    expectError(
      (await select(token, characterId, { mode: 'FARM', stage: '9007199254740996' }).expect(409))
        .body,
      'STAGE_LOCKED',
    );
  });

  it('a locked stage writes nothing: the row and its version are unchanged', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n });
    const before = await row(characterId);

    expectError(
      (await select(token, characterId, { mode: 'FARM', stage: '999999' }).expect(409)).body,
      'STAGE_LOCKED',
    );

    expect(await row(characterId)).toEqual(before);
  });

  it('another player’s character cannot be changed', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();
    const before = await row(bob.characterId);

    await select(alice.token, bob.characterId, { mode: 'FARM', stage: '1' }).expect(404);

    expect(await row(bob.characterId)).toEqual(before);
  });
});

describe('farming against PostgreSQL — records and rewards', () => {
  it('farming stage 99 below the unbeaten stage-100 boss never clears the boss', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 100n, reached: 100n, cleared: 99n });
    await select(token, characterId, { mode: 'FARM', stage: '99' }).expect(200);

    const goldBefore = (await row(characterId)).goldCoef;
    for (let round = 0; round < 20; round += 1) {
      const combat = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
      expect(combat.combat.stage.number).toBe('99');
      expect(combat.combat.outcome).toBe('WIN');
      clock.advance(combat.combat.durationMs);
    }

    const after = await row(characterId);
    expect(view(after)).toBe('FARM 99 / 100 / 99');
    expect(after.goldCoef).not.toBe(goldBefore);
    const runs = await prisma.client.combatRun.findMany({ where: { characterId } });
    expect(runs).toHaveLength(20);
    expect(runs.every((run) => run.stageMode === 'FARM' && run.stage === 99n)).toBe(true);
    expect(runs.every((run) => run.highestStageReachedBefore === 100n)).toBe(true);
    expect(runs.every((run) => run.highestStageClearedBefore === 99n)).toBe(true);
  });

  it('climbing again after farming fights the boss and continues the records', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 100n, reached: 100n, cleared: 99n });
    await select(token, characterId, { mode: 'FARM', stage: '99' }).expect(200);
    const farmed = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    clock.advance(farmed.combat.durationMs);

    await select(token, characterId, { mode: 'PROGRESS' }).expect(200);
    const boss = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    expect(boss.combat.stage).toEqual({ number: '100', kind: 'BOSS' });
    expect(boss.combat.outcome).toBe('WIN');
    expect(view(await row(characterId))).toBe('PROGRESS 101 / 101 / 100');
  });

  it('replays a farm combat from the database after the mode changed', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n });
    await select(token, characterId, { mode: 'FARM', stage: '9' }).expect(200);
    const key = randomUUID();
    const first = await fight(token, characterId, app, key).expect(201);
    await select(token, characterId, { mode: 'PROGRESS' }).expect(200);

    const replay = await fight(token, characterId, app, key).expect(200);

    const parse = (body: unknown) => combatResponseSchema.parse(body);
    expect(parse(replay.body).combat).toEqual(parse(first.body).combat);
    expect(parse(replay.body).after).toEqual(parse(first.body).after);
    expect(parse(first.body).after.currentStage).toBe('9');
  });
});

describe('stage selection against PostgreSQL — concurrency', () => {
  it('selections racing combats across two API instances never leave an inconsistent row', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n }, 60);
    const second = await newApiInstance();
    extraApps.push(second);

    const selections = ['3', '9', '1', '10', '5', '2', '7', '8'].map((stage, index) =>
      select(token, characterId, { mode: 'FARM', stage }, index % 2 === 0 ? app : second),
    );
    const climbs = Array.from({ length: 4 }, (_, index) =>
      select(token, characterId, { mode: 'PROGRESS' }, index % 2 === 0 ? second : app),
    );
    const combats = Array.from({ length: 12 }, (_, index) =>
      fight(token, characterId, index % 2 === 0 ? app : second),
    );
    const responses = await Promise.all([...selections, ...climbs, ...combats]);

    for (const response of responses) {
      expect([200, 201, 409]).toContain(response.status);
    }
    const committed = responses.filter((response) => response.status === 201);
    expect(committed.length).toBeLessThanOrEqual(1);

    const after = await row(characterId);
    const runs = await prisma.client.combatRun.findMany({ where: { characterId } });
    expect(runs).toHaveLength(committed.length);
    // The invariants hold, the records never fell and only a recorded win
    // could have raised them.
    expect(after.currentStage <= after.highestStageReached).toBe(true);
    expect(after.highestStageReached >= 10n).toBe(true);
    expect(after.highestStageCleared !== null && after.highestStageCleared >= 9n).toBe(true);
    const wins = runs.filter((run) => run.outcome === 'WIN').map((run) => run.stage);
    const bestWin = wins.reduce((best, stage) => (stage > best ? stage : best), 9n);
    expect(after.highestStageCleared).toBe(bestWin);
    // Every write — selection or combat — advanced the version exactly once.
    expect(after.version).toBeGreaterThanOrEqual(BigInt(runs.length));
  });

  it('a combat simulated before a selection commits nothing after it', async () => {
    const { characterId } = await provisionedPlayer();
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n }, 60);
    const { version } = await row(characterId);
    const selections = new PrismaStageSelectionRepository(prisma);
    const combats = new PrismaCombatRepository(prisma);
    const owner = (await prisma.client.profile.findFirstOrThrow()).authUserId;

    const saved = await selections.saveSelection({
      authUserId: owner,
      characterId,
      expectedVersion: version,
      currentStage: StageNumber.of(3),
      stageMode: 'FARM',
    });
    const loaded = await combats.loadTarget(owner, characterId, randomUUID());

    expect(saved.kind).toBe('saved');
    expect(loaded?.version).toBe(version + 1n);
    const stale = await selections.saveSelection({
      authUserId: owner,
      characterId,
      expectedVersion: version,
      currentStage: StageNumber.of(8),
      stageMode: 'PROGRESS',
    });
    expect(stale).toEqual({ kind: 'conflict' });
    expect(view(await row(characterId))).toBe('FARM 3 / 10 / 9');
  });

  it('the repository refuses a foreign owner even with the right version', async () => {
    const { characterId } = await provisionedPlayer();
    const { version } = await row(characterId);

    const result = await new PrismaStageSelectionRepository(prisma).saveSelection({
      authUserId: randomUUID(),
      characterId,
      expectedVersion: version,
      currentStage: StageNumber.FIRST,
      stageMode: 'FARM',
    });

    expect(result).toEqual({ kind: 'conflict' });
    expect(view(await row(characterId))).toBe('PROGRESS 1 / 1 / null');
  });
});

describe('schema constraints — stage mode', () => {
  it('rejects a farm stage beyond the highest reached, whatever the application does', async () => {
    const { characterId } = await provisionedPlayer();
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE characters SET current_stage = 2, stage_mode = 'FARM' WHERE id = '${characterId}'`,
      ),
    ).rejects.toThrow();
  });

  it.each(["'CLIMB'", "'farm'", "''", 'NULL'])('rejects stage mode %s', async (value) => {
    const { characterId } = await provisionedPlayer();
    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE characters SET stage_mode = ${value} WHERE id = '${characterId}'`,
      ),
    ).rejects.toThrow();
  });

  it('requires every combat to state the mode it was fought in', async () => {
    const [column] = await prisma.client.$queryRawUnsafe<
      { is_nullable: string; column_default: string | null }[]
    >(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'combat_runs' AND column_name = 'stage_mode'`,
    );
    expect(column).toEqual({ is_nullable: 'NO', column_default: null });
  });
});

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}
