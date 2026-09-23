import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  combatResponseSchema,
  playerStateResponseSchema,
  type CombatResponse,
} from '@eternal-forge/contracts';
import { HugeNumber } from '@eternal-forge/game-core';
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
 * Online auto-battle against a real PostgreSQL (ADR-022).
 *
 * Auto-battle has no endpoint of its own: the browser repeats the ordinary
 * combat request, one fresh idempotency key per fight, whenever the server's
 * `nextCombatAt` allows. These tests drive exactly that request sequence —
 * and the ways a hostile or unlucky client can deviate from it — through the
 * real guard, controllers, use cases, Game Core and database. The server's
 * clock is a {@link ManualClock}, so "waiting for the pacing gate" is exact
 * and no test sleeps.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let clock: ManualClock;
let app: INestApplication;
const extraApps: INestApplication[] = [];

/** 2^53 + 1: the first integer a JavaScript `number` cannot hold. */
const BEYOND_SAFE_INTEGER = 9_007_199_254_740_993n;

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
    seeds: sequentialSeeds(`auto-${randomUUID().slice(0, 8)}`),
    clock,
  });
}

async function provisionedPlayer() {
  const token = await issuer.issue({ sub: randomUUID() });
  const response = await request(httpServer(app))
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

function select(token: string, characterId: string, body: object) {
  return request(httpServer(app))
    .put(`/player/characters/${characterId}/stage-selection`)
    .set('authorization', `Bearer ${token}`)
    .send(body)
    .expect(200);
}

async function playerState(token: string) {
  const response = await request(httpServer(app))
    .get('/player/state')
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return playerStateResponseSchema.parse(response.body);
}

/** Moves the server clock to the instant the server named. Never beyond it. */
function waitUntil(nextCombatAt: string): void {
  clock.advance(Math.max(0, Date.parse(nextCombatAt) - clock.now().getTime()));
}

/**
 * One auto-battle step as the web client performs it: a fresh key, the
 * ordinary combat request, then a wait until the server's `nextCombatAt`.
 */
async function autoStep(token: string, characterId: string): Promise<CombatResponse> {
  const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
  waitUntil(body.progression.nextCombatAt);
  return body;
}

async function row(characterId: string) {
  return prisma.client.character.findUniqueOrThrow({ where: { id: characterId } });
}

async function runsOf(characterId: string) {
  return prisma.client.combatRun.findMany({
    where: { characterId },
    orderBy: { createdAt: 'asc' },
  });
}

/** `MODE current / reached / cleared`, as ADR-020 and ADR-021 write it. */
function view(value: {
  stageMode: string;
  currentStage: bigint;
  highestStageReached: bigint;
  highestStageCleared: bigint | null;
}): string {
  return `${value.stageMode} ${value.currentStage.toString()} / ${value.highestStageReached.toString()} / ${value.highestStageCleared?.toString() ?? 'null'}`;
}

async function place(
  characterId: string,
  stages: { current: bigint; reached: bigint; cleared: bigint | null },
  level: number,
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

describe('online auto-battle — the loop is the ordinary combat, repeated', () => {
  it('PROGRESS: every fight is on the stage the server named last, and every reward lands once', async () => {
    const { token, characterId } = await provisionedPlayer();
    let next = (await playerState(token)).progression.currentStage;
    let gold = HugeNumber.ZERO;

    for (let step = 0; step < 15; step += 1) {
      const body = await autoStep(token, characterId);
      // The client never computes the next stage; it is always the server's.
      expect(body.combat.stage.number).toBe(next);
      expect(body.before.gold).toBe(gold.toString());
      gold = HugeNumber.parse(body.after.gold);
      next = body.progression.currentStage;
    }

    const runs = await runsOf(characterId);
    expect(runs).toHaveLength(15);
    expect(runs.every((run) => run.stageMode === 'PROGRESS')).toBe(true);
    const ledger = runs.reduce(
      (sum, run) => sum.add(HugeNumber.fromParts(run.rewardGoldCoef, run.rewardGoldExp)),
      HugeNumber.ZERO,
    );
    const persisted = await row(characterId);
    expect(HugeNumber.fromParts(persisted.goldCoef, persisted.goldExp).eq(ledger)).toBe(true);
    expect(persisted.version).toBe(15n);
  });

  it('FARM: stays on the chosen stage fight after fight; the records do not move', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n }, 60);
    await select(token, characterId, { mode: 'FARM', stage: '5' });

    for (let step = 0; step < 8; step += 1) {
      const body = await autoStep(token, characterId);
      expect(body.combat.stage.number).toBe('5');
      expect(body.combat.outcome).toBe('WIN');
      expect(body.progression.currentStage).toBe('5');
    }

    expect(view(await row(characterId))).toBe('FARM 5 / 10 / 9');
    expect((await runsOf(characterId)).map((run) => run.stage)).toEqual(Array(8).fill(5n));
  });

  it('FARM on the uncleared frontier: the first win is a real clear, the hero stays there', async () => {
    const { token, characterId } = await provisionedPlayer();
    // Stage 10 (a boss) reached, not cleared; strong enough to beat it.
    await place(characterId, { current: 9n, reached: 10n, cleared: 9n }, 60);
    await select(token, characterId, { mode: 'FARM', stage: '10' });

    const first = await autoStep(token, characterId);
    expect(first.combat.stage).toEqual({ number: '10', kind: 'BOSS' });
    expect(first.combat.outcome).toBe('WIN');
    expect(view(await row(characterId))).toBe('FARM 10 / 11 / 10');

    const second = await autoStep(token, characterId);
    expect(second.combat.stage.number).toBe('10');
    expect(view(await row(characterId))).toBe('FARM 10 / 11 / 10');
  });

  it('a mode change between fights: the next fight uses the fresh server state', async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(characterId, { current: 25n, reached: 30n, cleared: 29n }, 200);
    await select(token, characterId, { mode: 'FARM', stage: '20' });

    expect((await autoStep(token, characterId)).combat.stage.number).toBe('20');

    // FARM 20 → FARM 15, then FARM 15 → PROGRESS, each between two fights.
    await select(token, characterId, { mode: 'FARM', stage: '15' });
    expect((await autoStep(token, characterId)).combat.stage.number).toBe('15');

    await select(token, characterId, { mode: 'PROGRESS' });
    const climbing = await autoStep(token, characterId);
    expect(climbing.combat.stage.number).toBe('30');
    expect(climbing.progression.currentStage).toBe('31');

    // PROGRESS → FARM while climbing.
    await select(token, characterId, { mode: 'FARM', stage: '31' });
    expect((await autoStep(token, characterId)).combat.stage.number).toBe('31');
    expect(
      (await runsOf(characterId)).map((run) => `${run.stageMode} ${run.stage.toString()}`),
    ).toEqual(['FARM 20', 'FARM 15', 'PROGRESS 30', 'FARM 31']);
  });

  it('a selection does not open the pacing gate: the wait is the combat’s, whatever the stage', async () => {
    const { token, characterId } = await provisionedPlayer();
    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    await select(token, characterId, { mode: 'FARM', stage: '1' });
    const early = await fight(token, characterId).expect(409);
    expect(apiErrorResponseSchema.parse(early.body).code).toBe('COMBAT_NOT_READY');

    waitUntil(body.progression.nextCombatAt);
    await fight(token, characterId).expect(201);
  });
});

describe('online auto-battle — the server paces it, not the browser', () => {
  it('a fight one millisecond early is refused with Retry-After; at the instant, it runs', async () => {
    const { token, characterId } = await provisionedPlayer();
    const first = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    const readyAt = Date.parse(first.progression.nextCombatAt);

    clock.advance(readyAt - clock.now().getTime() - 1);
    const early = await fight(token, characterId).expect(409);
    expect(apiErrorResponseSchema.parse(early.body).code).toBe('COMBAT_NOT_READY');
    expect(Number(early.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    clock.advance(1);
    await fight(token, characterId).expect(201);
    expect(await runsOf(characterId)).toHaveLength(2);
  });

  it('spam: 60 fresh keys while the hero fights write nothing and gain nothing', async () => {
    const { token, characterId } = await provisionedPlayer();
    const first = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    const before = await row(characterId);

    const statuses = (
      await Promise.all(Array.from({ length: 60 }, () => fight(token, characterId)))
    ).map((response) => response.status);

    expect(statuses).toEqual(Array(60).fill(409));
    expect(await row(characterId)).toEqual(before);
    expect(await runsOf(characterId)).toHaveLength(1);

    // A client that believed its own clock ran ahead gets the same answer:
    // only the server's clock opens the gate.
    waitUntil(first.progression.nextCombatAt);
    await fight(token, characterId).expect(201);
  });

  it('bounded throughput: 40 seconds of a greedy client yield no more fights than the combats took', async () => {
    const { token, characterId } = await provisionedPlayer();
    const started = clock.now().getTime();
    let fought = 0;
    let combatTime = 0;

    // A client that fires every 250 ms, whatever the server says.
    while (clock.now().getTime() - started < 40_000) {
      const response = await fight(token, characterId);
      if (response.status === 201) {
        fought += 1;
        combatTime += combatResponseSchema.parse(response.body).combat.durationMs;
      } else {
        expect(response.status).toBe(409);
      }
      clock.advance(250);
    }

    // Every committed fight occupied the hero for its whole duration.
    expect(combatTime).toBeLessThanOrEqual(40_000 + 30_000);
    expect(fought).toBe((await runsOf(characterId)).length);
    const runs = await runsOf(characterId);
    for (let index = 1; index < runs.length; index += 1) {
      const previous = runs[index - 1];
      const current = runs[index];
      if (previous !== undefined && current !== undefined) {
        expect(current.createdAt.getTime() - previous.createdAt.getTime()).toBeGreaterThanOrEqual(
          previous.durationMs,
        );
      }
    }
  });
});

describe('online auto-battle — retries, tabs and devices', () => {
  it('a lost response retried with its key replays the fight: one fight, one reward', async () => {
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();
    const original = await fight(token, characterId, key).expect(201);
    const before = await row(characterId);

    // The response was lost; the client retries the same intent, later.
    clock.advance(10_000);
    const retried = await fight(token, characterId, key).expect(200);

    expect(combatResponseSchema.parse(retried.body).combat).toEqual(
      combatResponseSchema.parse(original.body).combat,
    );
    expect(await row(characterId)).toEqual(before);
    expect(await runsOf(characterId)).toHaveLength(1);
  });

  it('two tabs auto-battling one hero share one timeline: one fight per window', async () => {
    const { token, characterId } = await provisionedPlayer();
    const tabB = await newApiInstance();
    extraApps.push(tabB);
    const windows = 10;

    for (let window = 0; window < windows; window += 1) {
      // Both tabs think the gate is open and fire at the same instant.
      const [a, b] = await Promise.all([
        fight(token, characterId, randomUUID(), app),
        fight(token, characterId, randomUUID(), tabB),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winner = combatResponseSchema.parse((a.status === 201 ? a : b).body);
      waitUntil(winner.progression.nextCombatAt);
    }

    const persisted = await row(characterId);
    expect(await runsOf(characterId)).toHaveLength(windows);
    expect(persisted.version).toBe(BigInt(windows));
  });

  it('a phone auto-battling and a desktop fighting by hand cannot double the pace', async () => {
    const { token, characterId } = await provisionedPlayer();
    const phone = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    // The desktop taps Fight while the phone's fight is still running.
    const desktop = await fight(token, characterId).expect(409);
    expect(apiErrorResponseSchema.parse(desktop.body).code).toBe('COMBAT_NOT_READY');

    // The phone's next auto fight and the desktop's retry race at the gate.
    waitUntil(phone.progression.nextCombatAt);
    const results = await Promise.all([fight(token, characterId), fight(token, characterId)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await runsOf(characterId)).toHaveLength(2);
  });
});

describe('online auto-battle — exact stages', () => {
  it('farms a stage in the billions exactly, fight after fight', async () => {
    const { token, characterId } = await provisionedPlayer();
    const stage = 4_000_000_001n;
    await place(
      characterId,
      { current: stage, reached: stage + 5n, cleared: stage + 4n },
      2_000_000,
    );
    await select(token, characterId, { mode: 'FARM', stage: stage.toString() });

    for (let step = 0; step < 3; step += 1) {
      const body = await autoStep(token, characterId);
      expect(body.combat.stage.number).toBe(stage.toString());
      expect(body.progression.currentStage).toBe(stage.toString());
    }
    expect((await row(characterId)).currentStage).toBe(stage);
  });

  it(`at stage ${BEYOND_SAFE_INTEGER.toString()} the loop is refused exactly, and nothing moves`, async () => {
    const { token, characterId } = await provisionedPlayer();
    await place(
      characterId,
      {
        current: BEYOND_SAFE_INTEGER,
        reached: BEYOND_SAFE_INTEGER,
        cleared: BEYOND_SAFE_INTEGER - 1n,
      },
      1,
    );
    const before = await row(characterId);

    const state = await playerState(token);
    expect(state.progression.currentStage).toBe('9007199254740993');
    // Under rules v1 no enemy can be scaled this deep (ADR-020 §7): the auto
    // loop's request is refused like a manual one, without a seed or a write.
    const refused = await fight(token, characterId).expect(409);
    expect(apiErrorResponseSchema.parse(refused.body).code).toBe('STAGE_NOT_PLAYABLE');
    expect(await row(characterId)).toEqual(before);
    expect(before.currentStage).toBe(BEYOND_SAFE_INTEGER);
  });
});

describe('online auto-battle — identity', () => {
  it('refuses a loop without a token, with an expired token, or with a forged one', async () => {
    const { characterId } = await provisionedPlayer();
    const expired = await issuer.issue({ sub: randomUUID(), expiresInSeconds: -60 });

    await request(httpServer(app))
      .post(`/player/characters/${characterId}/combats`)
      .set('idempotency-key', randomUUID())
      .expect(401);
    await fight(expired, characterId).expect(401);
    await fight('not.a.jwt', characterId).expect(401);
    expect(await runsOf(characterId)).toHaveLength(0);
  });

  it('another player’s token cannot drive this hero’s loop', async () => {
    const { characterId } = await provisionedPlayer();
    const stranger = await provisionedPlayer();

    await fight(stranger.token, characterId).expect(404);
    expect(await runsOf(characterId)).toHaveLength(0);
  });
});
