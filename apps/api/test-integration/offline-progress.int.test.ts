import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  combatResponseSchema,
  offlineProgressResponseSchema,
  playerStateResponseSchema,
} from '@eternal-forge/contracts';
import {
  GAME_RULES_VERSION,
  HugeNumber,
  StageNumber,
  resolveOfflineProgress,
} from '@eternal-forge/game-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { verifyOfflineRun } from '../src/offline/domain/offline-run.js';
import { PrismaOfflineProgressRepository } from '../src/offline/infrastructure/prisma-offline-progress.repository.js';
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
 * Offline progression against a real PostgreSQL (ADR-023), through the real
 * guard, controllers, use cases, Game Core and database. The server clock is
 * a {@link ManualClock} shared by every API instance, so "being away for
 * eight hours" is exact and no test sleeps.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2^53 + 1: the first integer a JavaScript `number` cannot hold. */
const BEYOND_SAFE_INTEGER = 9_007_199_254_740_993n;

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
    offline: new PrismaOfflineProgressRepository(prisma),
    seeds: sequentialSeeds(`combat-${randomUUID().slice(0, 8)}`),
    offlineSeeds: sequentialSeeds(`offline-${randomUUID().slice(0, 8)}`),
    clock,
  });
}

async function secondInstance(): Promise<INestApplication> {
  const instance = await newApiInstance();
  extraApps.push(instance);
  return instance;
}

interface Hero {
  readonly sub: string;
  readonly characterId: string;
  /** A token valid at the server clock's current time. */
  token(): Promise<string>;
}

/**
 * A provisioned hero standing on `current / reached / cleared` at `level`,
 * idle from the current server time.
 */
interface HeroOptions {
  readonly current?: bigint;
  readonly reached?: bigint;
  readonly cleared?: bigint | null;
  readonly level?: number;
  readonly mode?: 'PROGRESS' | 'FARM';
}

async function hero({
  current = 10n,
  reached = 10n,
  cleared = 9n,
  level = 10,
  mode = 'PROGRESS',
}: HeroOptions = {}): Promise<Hero> {
  const sub = randomUUID();
  const token = () => issuer.issue({ sub, now: clock.now() });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${await token()}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const characterId = playerStateResponseSchema.parse(response.body).character.id;
  await prisma.client.character.update({
    where: { id: characterId },
    data: {
      level,
      currentStage: current,
      highestStageReached: reached,
      highestStageCleared: cleared,
      stageMode: mode,
      nextCombatAt: clock.now(),
    },
  });
  return { sub, characterId, token };
}

async function claim(who: Hero, key: string = randomUUID(), instance: INestApplication = app) {
  return request(httpServer(instance))
    .post(`/player/characters/${who.characterId}/offline-progress`)
    .set('authorization', `Bearer ${await who.token()}`)
    .set('idempotency-key', key);
}

async function fight(who: Hero, instance: INestApplication = app) {
  return request(httpServer(instance))
    .post(`/player/characters/${who.characterId}/combats`)
    .set('authorization', `Bearer ${await who.token()}`)
    .set('idempotency-key', randomUUID());
}

async function select(who: Hero, body: object) {
  return request(httpServer(app))
    .put(`/player/characters/${who.characterId}/stage-selection`)
    .set('authorization', `Bearer ${await who.token()}`)
    .send(body);
}

const row = (characterId: string) =>
  prisma.client.character.findUniqueOrThrow({ where: { id: characterId } });
const offlineRuns = (characterId: string) =>
  prisma.client.offlineRun.findMany({ where: { characterId }, orderBy: { createdAt: 'asc' } });

async function storedRuns(characterId: string) {
  const repository = new PrismaOfflineProgressRepository(prisma);
  const runs = await offlineRuns(characterId);
  return Promise.all(
    runs.map(async (run) => {
      const character = await row(characterId);
      const profile = await prisma.client.profile.findUniqueOrThrow({
        where: { id: character.profileId },
      });
      const target = await repository.loadClaimTarget(
        profile.authUserId,
        characterId,
        run.idempotencyKey,
      );
      if (target?.existingRun == null) {
        throw new Error('stored run not found');
      }
      return target.existingRun;
    }),
  );
}

describe('offline progress — a claim against PostgreSQL', () => {
  it('commits rewards, the processed boundary, the next seed and the record together', async () => {
    const who = await hero();
    const before = await row(who.characterId);
    clock.advance(5 * HOUR);

    const body = offlineProgressResponseSchema.parse((await claim(who)).body);
    const after = await row(who.characterId);
    const [run] = await offlineRuns(who.characterId);

    const expected = resolveOfflineProgress({
      progress: {
        level: before.level,
        experience: HugeNumber.fromParts(before.experienceCoef, before.experienceExp),
        gold: HugeNumber.fromParts(before.goldCoef, before.goldExp),
        stages: {
          current: StageNumber.of(before.currentStage),
          highestReached: StageNumber.of(before.highestStageReached),
          highestCleared: StageNumber.of(before.highestStageCleared ?? 1n),
        },
      },
      elapsedMs: 5 * HOUR,
      seed: before.offlineSeed,
      rulesVersion: GAME_RULES_VERSION,
    });

    expect(body.offline.fights).toBe(expected.fights);
    // ADR-026: offline claims remain aggregate gold/XP only until a bounded
    // persistent item-batch design is approved.
    expect(
      await prisma.client.itemInstance.count({ where: { characterId: who.characterId } }),
    ).toBe(0);
    expect(after.level).toBe(expected.after.level);
    expect(HugeNumber.fromParts(after.goldCoef, after.goldExp).eq(expected.after.gold)).toBe(true);
    expect(after.nextCombatAt.toISOString()).toBe(body.offline.processedUntil);
    expect(after.version).toBe(before.version + 1n);
    expect(after.offlineSeed).not.toBe(before.offlineSeed);
    // Stage, mode and records untouched.
    expect([after.currentStage, after.highestStageReached, after.highestStageCleared]).toEqual([
      10n,
      10n,
      9n,
    ]);
    expect(after.stageMode).toBe('PROGRESS');

    expect(run?.seed).toBe(before.offlineSeed);
    expect(run?.targetStage).toBe(9n);
    expect(run?.idleSince).toEqual(before.nextCombatAt);
    expect(run?.fights).toBe(expected.fights);
  });

  it('replays every stored claim exactly from its inputs', async () => {
    const who = await hero({ level: 9, current: 11n, reached: 11n, cleared: 10n });
    for (const away of [2 * HOUR, 90 * MINUTE, 11 * HOUR]) {
      clock.advance(away);
      expect((await claim(who)).status).toBe(201);
    }
    const runs = await storedRuns(who.characterId);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(verifyOfflineRun(run)).toBe(true);
    }
  });

  it('accounts for each interval once: the boundaries chain without overlap', async () => {
    const who = await hero();
    for (const away of [3 * HOUR, 10 * MINUTE, 9 * HOUR]) {
      clock.advance(away);
      await claim(who);
    }
    const runs = await offlineRuns(who.characterId);
    for (let index = 1; index < runs.length; index += 1) {
      const previous = runs[index - 1];
      const next = runs[index];
      expect(next!.idleSince.getTime()).toBe(previous!.processedUntil.getTime());
      expect(next!.rewardedFrom.getTime()).toBeGreaterThanOrEqual(
        previous!.processedUntil.getTime(),
      );
    }
  });

  it('writes nothing for a hero with no cleared stage', async () => {
    const who = await hero({ current: 1n, reached: 1n, cleared: null, level: 1 });
    const before = await row(who.characterId);
    clock.advance(8 * HOUR);
    const body = offlineProgressResponseSchema.parse((await claim(who)).body);
    expect(body.offline.idleReason).toBe('NO_CLEARED_STAGE');
    expect(await row(who.characterId)).toEqual(before);
  });

  it('keeps a stage of 2^53 + 1 exact and refuses it as not playable, writing nothing', async () => {
    const who = await hero({
      current: BEYOND_SAFE_INTEGER,
      reached: BEYOND_SAFE_INTEGER + 1n,
      cleared: BEYOND_SAFE_INTEGER,
      mode: 'FARM',
    });
    const before = await row(who.characterId);
    clock.advance(HOUR);
    const body = offlineProgressResponseSchema.parse((await claim(who)).body);
    expect(body.offline.idleReason).toBe('STAGE_NOT_PLAYABLE');
    expect(body.progression.currentStage).toBe('9007199254740993');
    expect(await row(who.characterId)).toEqual(before);
  });

  it('persists enormous accumulated gold exactly', async () => {
    const who = await hero({ current: 1_001n, reached: 1_001n, cleared: 1_000n, level: 2_000 });
    clock.advance(8 * HOUR);
    const body = offlineProgressResponseSchema.parse((await claim(who)).body);
    const after = await row(who.characterId);
    expect(body.offline.fights).toBe(28_800);
    expect(HugeNumber.fromParts(after.goldCoef, after.goldExp).toString()).toBe(
      body.character.gold,
    );
    expect(HugeNumber.parse(body.offline.rewards.gold).gt(HugeNumber.fromDecimal('1e50'))).toBe(
      true,
    );
  });
});

describe('offline progress — idempotency and concurrency', () => {
  it('the same key 100 times (25 at once) produces one claim', async () => {
    const who = await hero();
    clock.advance(4 * HOUR);
    const key = randomUUID();
    const statuses: number[] = [];
    for (let wave = 0; wave < 4; wave += 1) {
      const responses = await Promise.all(Array.from({ length: 25 }, () => claim(who, key)));
      statuses.push(...responses.map((response) => response.status));
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(99);
    expect(await offlineRuns(who.characterId)).toHaveLength(1);
  });

  it('100 different keys at once across two API instances produce one claim', async () => {
    const other = await secondInstance();
    const who = await hero();
    clock.advance(6 * HOUR);
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        claim(who, randomUUID(), index % 2 === 0 ? app : other),
      ),
    );
    const bodies = responses
      .filter((response) => response.status === 200 || response.status === 201)
      .map((response) => offlineProgressResponseSchema.parse(response.body));

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    // The others found nothing left, or gave up as busy; none collected.
    expect(bodies.filter((body) => body.offline.fights > 0)).toHaveLength(1);
    expect(responses.every((response) => [200, 201, 409].includes(response.status))).toBe(true);
    const runs = await offlineRuns(who.characterId);
    expect(runs).toHaveLength(1);
    const after = await row(who.characterId);
    // Provisioned at version 0 (the fixture writes directly); exactly one claim committed.
    expect(after.version).toBe(1n);
  });

  it('a lost response is recovered by retrying the key on another instance', async () => {
    const other = await secondInstance();
    const who = await hero();
    clock.advance(2 * HOUR);
    const key = randomUUID();
    const first = offlineProgressResponseSchema.parse((await claim(who, key)).body);
    clock.advance(30 * MINUTE);
    const retry = await claim(who, key, other);
    expect(retry.status).toBe(200);
    expect(offlineProgressResponseSchema.parse(retry.body).offline).toEqual(first.offline);
    expect(await offlineRuns(who.characterId)).toHaveLength(1);
  });

  it('a combat racing a claim never lets both account for the same time', async () => {
    const other = await secondInstance();
    for (let round = 0; round < 5; round += 1) {
      const who = await hero();
      clock.advance(3 * HOUR);
      const [claimed, fought] = await Promise.all([claim(who), fight(who, other)]);
      const runs = await offlineRuns(who.characterId);
      const combats = await prisma.client.combatRun.findMany({
        where: { characterId: who.characterId },
      });

      if (fought.status === 201) {
        const combat = combatResponseSchema.parse(fought.body);
        // The fight ended the idle time. A claim can only have committed first,
        // and then the fight started after the claim's processed boundary.
        for (const run of runs) {
          expect(Date.parse(combat.combat.resolvedAt)).toBeGreaterThanOrEqual(
            run.processedUntil.getTime(),
          );
        }
      } else {
        expect(fought.status).toBe(409);
        expect(runs).toHaveLength(1);
      }
      expect([200, 201, 409]).toContain(claimed.status);
      expect(runs.length + combats.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('a stage selection racing a claim keeps every invariant and never moves a record', async () => {
    const who = await hero({ current: 40n, reached: 41n, cleared: 40n, level: 300 });
    clock.advance(2 * HOUR);
    const [claimed, selected] = await Promise.all([
      claim(who),
      select(who, { mode: 'FARM', stage: '25' }),
    ]);
    expect([200, 201]).toContain(claimed.status);
    expect(selected.status).toBe(200);
    const after = await row(who.characterId);
    expect(after.currentStage).toBe(25n);
    expect(after.stageMode).toBe('FARM');
    expect([after.highestStageReached, after.highestStageCleared]).toEqual([41n, 40n]);
    const runs = await offlineRuns(who.characterId);
    expect(runs.length).toBeLessThanOrEqual(1);
    expect(runs.every((run) => run.targetStage === 25n || run.targetStage === 40n)).toBe(true);
  });

  it('an auto-battle style client and a returning device share one time line', async () => {
    const who = await hero();
    // Fight online back to back for a while: the gate moves the boundary.
    for (let step = 0; step < 10; step += 1) {
      const combat = combatResponseSchema.parse((await fight(who)).body);
      clock.advance(
        Math.max(0, Date.parse(combat.progression.nextCombatAt) - clock.now().getTime()),
      );
    }
    // Online play leaves no idle time to claim.
    const immediately = offlineProgressResponseSchema.parse((await claim(who)).body);
    expect(immediately.offline.fights).toBe(0);
    expect(immediately.offline.idleReason).toBe('TOO_SOON');

    // Then the tab closes for two hours: exactly those two hours count.
    const lastBoundary = (await row(who.characterId)).nextCombatAt;
    clock.advance(2 * HOUR);
    const back = offlineProgressResponseSchema.parse((await claim(who)).body);
    expect(back.offline.idleSince).toBe(lastBoundary.toISOString());
    expect(back.offline.elapsedMs).toBe(2 * HOUR);
  });
});

describe('offline progress — atomicity and constraints', () => {
  it('rolls back the character update when the record cannot be written', async () => {
    const who = await hero();
    const before = await row(who.characterId);
    const profile = await prisma.client.profile.findUniqueOrThrow({
      where: { id: before.profileId },
    });
    const repository = new PrismaOfflineProgressRepository(prisma);
    const now = clock.now();
    const failing = repository.commitClaim({
      authUserId: profile.authUserId,
      characterId: who.characterId,
      expectedVersion: before.version,
      level: 99,
      experience: HugeNumber.ZERO,
      gold: HugeNumber.fromDecimal('1e9'),
      processedUntil: now,
      nextOfflineSeed: 'next',
      run: {
        characterId: who.characterId,
        idempotencyKey: randomUUID(),
        rulesVersion: 1,
        seed: 'seed',
        idleSince: now,
        rewardedFrom: now,
        processedUntil: new Date(now.getTime() + 1_000),
        claimedAt: now,
        before: {
          level: 10,
          experience: HugeNumber.ZERO,
          gold: HugeNumber.ZERO,
          stages: {
            current: StageNumber.of(10),
            highestReached: StageNumber.of(10),
            highestCleared: StageNumber.of(9),
          },
        },
        // Beyond the record: the CHECK refuses it, so the transaction rolls back.
        targetStage: StageNumber.of(10),
        fights: 1,
        wins: 1,
        losses: 0,
        levelsGained: 0,
        rewards: { gold: HugeNumber.ONE, experience: HugeNumber.ONE },
      },
    });
    await expect(failing).rejects.toThrow();
    expect(await row(who.characterId)).toEqual(before);
    expect(await offlineRuns(who.characterId)).toHaveLength(0);
  });

  it('refuses a stale version and a foreign owner, writing nothing', async () => {
    const who = await hero();
    clock.advance(HOUR);
    const before = await row(who.characterId);
    const repository = new PrismaOfflineProgressRepository(prisma);
    const profile = await prisma.client.profile.findUniqueOrThrow({
      where: { id: before.profileId },
    });
    const target = await repository.loadClaimTarget(
      profile.authUserId,
      who.characterId,
      randomUUID(),
    );
    if (target === null) {
      throw new Error('missing');
    }
    const result = resolveOfflineProgress({
      progress: target.character,
      elapsedMs: HOUR,
      seed: target.offlineSeed,
      rulesVersion: GAME_RULES_VERSION,
    });
    const now = clock.now();
    const command = {
      characterId: who.characterId,
      level: result.after.level,
      experience: result.after.experience,
      gold: result.after.gold,
      processedUntil: now,
      nextOfflineSeed: 'next',
      run: {
        characterId: who.characterId,
        idempotencyKey: randomUUID(),
        rulesVersion: 1,
        seed: target.offlineSeed,
        idleSince: target.character.nextCombatAt,
        rewardedFrom: target.character.nextCombatAt,
        processedUntil: now,
        claimedAt: now,
        before: result.before,
        targetStage: StageNumber.of(9),
        fights: result.fights,
        wins: result.wins,
        losses: result.losses,
        levelsGained: result.levelsGained,
        rewards: result.rewards,
      },
    };
    expect(
      (
        await repository.commitClaim({
          ...command,
          authUserId: profile.authUserId,
          expectedVersion: target.version + 7n,
        })
      ).kind,
    ).toBe('conflict');
    expect(
      (
        await repository.commitClaim({
          ...command,
          authUserId: randomUUID(),
          expectedVersion: target.version,
        })
      ).kind,
    ).toBe('conflict');
    expect(await row(who.characterId)).toEqual(before);
    expect(await offlineRuns(who.characterId)).toHaveLength(0);
  });

  it.each([
    ['time accounted after the claim', { processed_until: "now() + interval '1 hour'" }],
    ['rewarded time before the idle time', { rewarded_from: "now() - interval '3 hours'" }],
    ['a target above the record', { target_stage: '10' }],
    ['counts that do not add up', { losses: '5' }],
    ['a claim without fights', { fights: '0', wins: '0' }],
    ['rewards without a win', { wins: '0', losses: '1' }],
    ['no cleared stage', { highest_stage_cleared: 'NULL' }],
  ])('the database refuses %s', async (_label, override) => {
    const who = await hero();
    const values: Record<string, string> = {
      character_id: `'${who.characterId}'`,
      idempotency_key: `'${randomUUID()}'`,
      rules_version: '1',
      seed: `'seed'`,
      idle_since: "now() - interval '2 hours'",
      rewarded_from: "now() - interval '2 hours'",
      processed_until: "now() - interval '1 second'",
      current_stage: '10',
      highest_stage_reached: '10',
      highest_stage_cleared: '9',
      character_level: '10',
      experience_before_coef: '0',
      experience_before_exp: '-2147483648',
      gold_before_coef: '0',
      gold_before_exp: '-2147483648',
      target_stage: '9',
      fights: '1',
      wins: '1',
      losses: '0',
      levels_gained: '0',
      reward_gold_coef: '100000000000000000',
      reward_gold_exp: '17',
      reward_experience_coef: '100000000000000000',
      reward_experience_exp: '17',
      ...override,
    };
    const columns = Object.keys(values).join(', ');
    const sql = `INSERT INTO offline_runs (${columns}) VALUES (${Object.values(values).join(', ')})`;
    await expect(prisma.client.$executeRawUnsafe(sql)).rejects.toThrow();
    expect(await offlineRuns(who.characterId)).toHaveLength(0);
  });

  it('enforces one claim per (character, key)', async () => {
    const who = await hero();
    clock.advance(HOUR);
    const key = randomUUID();
    await claim(who, key);
    const [run] = await offlineRuns(who.characterId);
    const { id: _id, ...copy } = run!;
    await expect(prisma.client.offlineRun.create({ data: copy })).rejects.toThrow();
  });
});

describe('row level security — offline_runs', () => {
  it('is enabled and denies a non-owner role by default', async () => {
    const who = await hero();
    clock.advance(HOUR);
    expect((await claim(who)).status).toBe(201);
    const role = 'ef_rls_offline_probe';

    const [enabled] = await prisma.client.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'offline_runs'`,
    );
    const visible = await prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT SELECT ON offline_runs TO ${role}`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      const [runs] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) FROM offline_runs',
      );
      await tx.$executeRawUnsafe('RESET ROLE');
      await tx.$executeRawUnsafe(`REVOKE ALL ON offline_runs FROM ${role}`);
      await tx.$executeRawUnsafe(`DROP ROLE ${role}`);
      return runs?.count;
    });

    expect(enabled?.relrowsecurity).toBe(true);
    expect(visible).toBe(0n);
  });
});
