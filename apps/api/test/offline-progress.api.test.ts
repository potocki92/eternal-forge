import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { StageNumber } from '@eternal-forge/game-core';
import {
  apiErrorResponseSchema,
  offlineProgressResponseSchema,
  playerStateResponseSchema,
} from '@eternal-forge/contracts';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ManualClock,
  createTestApp,
  httpServer,
  sequentialSeeds,
} from './support/create-test-app.js';
import { InMemoryGameRepository } from './support/in-memory-game.repository.js';
import { TestTokenIssuer } from './support/token-issuer.js';

/**
 * HTTP-level behaviour of `POST /player/characters/:characterId/offline-progress`
 * (ADR-023): authentication, ownership, input validation, server time and
 * idempotency, through the real guard, verifier, controller and exception
 * filter. The PostgreSQL path is covered in `test-integration/`.
 */

const HOUR = 3_600_000;

let issuer: TestTokenIssuer;
let app: INestApplication;
let repository: InMemoryGameRepository;
let clock: ManualClock;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
});

beforeEach(async () => {
  clock = new ManualClock();
  repository = new InMemoryGameRepository(() => clock.now());
  app = await createTestApp({
    issuer,
    players: repository,
    combats: repository,
    selections: repository,
    offline: repository,
    seeds: sequentialSeeds('http'),
    clock,
  });
});

afterEach(async () => {
  await app.close();
});

/** A provisioned hero that has cleared stages 1–9 and stands on the stage-10 boss. */
async function heroAtBoss() {
  const sub = randomUUID();
  const token = await issuer.issue({ sub, now: clock.now() });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const characterId = playerStateResponseSchema.parse(response.body).character.id;
  repository.updateCharacter(characterId, {
    level: 10,
    stages: {
      current: StageNumber.of(10),
      highestReached: StageNumber.of(10),
      highestCleared: StageNumber.of(9),
    },
    nextCombatAt: clock.now(),
  });
  // A token issued now, for tests that move the clock past a token's lifetime.
  const fresh = () => issuer.issue({ sub, now: clock.now() });
  return { token, characterId, fresh };
}

/** `key: null` sends no Idempotency-Key header at all. */
function claim(token: string, characterId: string, key: string | null = randomUUID()) {
  const call = request(httpServer(app))
    .post(`/player/characters/${characterId}/offline-progress`)
    .set('authorization', `Bearer ${token}`);
  return key === null ? call : call.set('idempotency-key', key);
}

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}

describe('offline progress — authentication and ownership', () => {
  it('rejects a request without a token', async () => {
    const { characterId } = await heroAtBoss();
    const response = await request(httpServer(app))
      .post(`/player/characters/${characterId}/offline-progress`)
      .set('idempotency-key', randomUUID())
      .expect(401);
    expectError(response.body, 'UNAUTHENTICATED');
  });

  it('rejects a forged token', async () => {
    const { characterId } = await heroAtBoss();
    const response = await claim('eyJhbGciOiJub25lIn0.e30.', characterId).expect(401);
    expectError(response.body, 'UNAUTHENTICATED');
  });

  it('answers 404 for another player’s character and writes nothing', async () => {
    const { characterId } = await heroAtBoss();
    clock.advance(HOUR);
    const stranger = await issuer.issue({ sub: randomUUID(), now: clock.now() });
    const response = await claim(stranger, characterId).expect(404);
    expectError(response.body, 'NOT_FOUND');
    expect(repository.offlineRunsOf(characterId)).toHaveLength(0);
  });

  it('answers 404 for a character that does not exist', async () => {
    const { token } = await heroAtBoss();
    expectError((await claim(token, randomUUID()).expect(404)).body, 'NOT_FOUND');
  });
});

describe('offline progress — input', () => {
  it.each([
    ['a missing key', null],
    ['a malformed key', 'not-a-uuid'],
  ])('rejects %s', async (_label, key) => {
    const { token, characterId } = await heroAtBoss();
    clock.advance(HOUR);
    const response = await claim(token, characterId, key).expect(400);
    expectError(response.body, 'VALIDATION_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('not-a-uuid');
    expect(repository.offlineRunsOf(characterId)).toHaveLength(0);
  });

  it('rejects a malformed character id', async () => {
    const { token } = await heroAtBoss();
    expectError((await claim(token, 'abc').expect(400)).body, 'VALIDATION_FAILED');
  });

  it('ignores a forged body: elapsed time, client clock, stage and rewards', async () => {
    const { token, characterId } = await heroAtBoss();
    clock.advance(10 * 60_000);
    const response = await claim(token, characterId)
      .send({
        elapsedSeconds: 999_999,
        lastSeen: '2000-01-01T00:00:00.000Z',
        clientTime: '2100-01-01T00:00:00.000Z',
        stage: '100',
        gold: '1e300',
        fights: 1_000_000,
      })
      .expect(201);
    const body = offlineProgressResponseSchema.parse(response.body);
    expect(body.offline.elapsedMs).toBe(10 * 60_000);
    expect(body.offline.targetStage?.number).toBe('9');
    expect(body.offline.fights).toBeLessThan(1_000);
  });
});

describe('offline progress — claims', () => {
  it('201 with the server-measured result, then 200 with the same result for the same key', async () => {
    const { characterId, fresh } = await heroAtBoss();
    clock.advance(3 * HOUR);
    const token = await fresh();
    const key = randomUUID();

    const first = offlineProgressResponseSchema.parse(
      (await claim(token, characterId, key).expect(201)).body,
    );
    const again = offlineProgressResponseSchema.parse(
      (await claim(token, characterId, key).expect(200)).body,
    );

    expect(first.offline.id).not.toBeNull();
    expect(first.offline.elapsedMs).toBe(3 * HOUR);
    expect(first.offline.fights).toBeGreaterThan(0);
    expect(again.offline).toEqual(first.offline);
    expect(again.character.gold).toBe(first.character.gold);
    expect(first.progression.currentStage).toBe('10');
    expect(first.progression.nextCombatAt).toBe(first.offline.processedUntil);
    expect(repository.offlineRunsOf(characterId)).toHaveLength(1);
  });

  it('200 with nothing to collect for a new key right after a claim', async () => {
    const { token, characterId } = await heroAtBoss();
    clock.advance(HOUR);
    await claim(token, characterId).expect(201);
    const second = offlineProgressResponseSchema.parse(
      (await claim(token, characterId).expect(200)).body,
    );
    expect(second.offline.id).toBeNull();
    expect(second.offline.idleReason).toBe('TOO_SOON');
    expect(second.offline.fights).toBe(0);
  });

  it('caps the absence at 8 hours', async () => {
    const { characterId, fresh } = await heroAtBoss();
    clock.advance(30 * HOUR);
    const token = await fresh();
    const body = offlineProgressResponseSchema.parse(
      (await claim(token, characterId).expect(201)).body,
    );
    expect(body.offline.capReached).toBe(true);
    expect(body.offline.rewardedMs).toBe(8 * HOUR);
    expect(body.offline.elapsedMs).toBe(30 * HOUR);
  });

  it('never exposes the seed or the owner', async () => {
    const { token, characterId } = await heroAtBoss();
    clock.advance(HOUR);
    const seed = repository.offlineSeedOf(characterId);
    const response = await claim(token, characterId).expect(201);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(seed);
    expect(text).not.toContain('seed');
    expect(text).not.toContain('authUserId');
  });

  it('lets the next combat start at once after a claim', async () => {
    const { token, characterId } = await heroAtBoss();
    clock.advance(HOUR);
    await claim(token, characterId).expect(201);
    await request(httpServer(app))
      .post(`/player/characters/${characterId}/combats`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .expect(201);
  });
});
