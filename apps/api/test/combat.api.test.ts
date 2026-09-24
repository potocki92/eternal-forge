import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { STAGE_NUMBER_MAX, StageNumber } from '@eternal-forge/game-core';
import {
  apiErrorResponseSchema,
  combatResponseSchema,
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
 * HTTP-level behaviour of `POST /player/characters/:characterId/combats`
 * (ADR-019): authentication, ownership, input validation, idempotency and
 * pacing, through the real guard, verifier, controller and exception filter.
 * The PostgreSQL path is covered in `test-integration/`.
 */

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
    seeds: sequentialSeeds('http'),
    clock,
  });
});

afterEach(async () => {
  await app.close();
});

async function provisionedPlayer() {
  const token = await issuer.issue({ sub: randomUUID(), now: clock.now() });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const state = playerStateResponseSchema.parse(response.body);

  return { token, characterId: state.character.id, state };
}

/** `key: null` sends no Idempotency-Key header at all. */
function fight(token: string, characterId: string, key: string | null = randomUUID()) {
  const call = request(httpServer(app))
    .post(`/player/characters/${characterId}/combats`)
    .set('authorization', `Bearer ${token}`);
  return key === null ? call : call.set('idempotency-key', key);
}

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}

describe('combat — authentication', () => {
  it('rejects a request without a token', async () => {
    const { characterId } = await provisionedPlayer();

    const response = await request(httpServer(app))
      .post(`/player/characters/${characterId}/combats`)
      .set('idempotency-key', randomUUID())
      .expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(repository.runsOf(characterId)).toHaveLength(0);
  });

  it('rejects a tampered token', async () => {
    const { token, characterId } = await provisionedPlayer();
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
        sub: randomUUID(),
      }),
    ).toString('base64url');

    const response = await fight(
      `${header ?? ''}.${forged}.${signature ?? ''}`,
      characterId,
    ).expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(repository.runsOf(characterId)).toHaveLength(0);
  });
});

describe('combat — authorization', () => {
  it('player A cannot fight with player B’s character', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();

    const response = await fight(alice.token, bob.characterId).expect(404);

    expectError(response.body, 'NOT_FOUND');
    expect(repository.runsOf(bob.characterId)).toHaveLength(0);
  });

  it('answers 404 for a character that does not exist', async () => {
    const { token } = await provisionedPlayer();

    expectError((await fight(token, randomUUID()).expect(404)).body, 'NOT_FOUND');
  });
});

describe('combat — input validation', () => {
  it('rejects a missing idempotency key', async () => {
    const { token, characterId } = await provisionedPlayer();

    const response = await fight(token, characterId, null).expect(400);

    expectError(response.body, 'VALIDATION_FAILED');
    expect(apiErrorResponseSchema.parse(response.body).issues).toEqual([
      { path: 'headers.Idempotency-Key', message: 'A UUID idempotency key is required.' },
    ]);
  });

  it.each(['retry-attempt', 'zz-not-a-uuid', "'; DROP TABLE combat_runs; --", 'x'.repeat(500)])(
    'rejects the malformed idempotency key %j without echoing it',
    async (key) => {
      const { token, characterId } = await provisionedPlayer();

      const response = await fight(token, characterId, key).expect(400);

      expectError(response.body, 'VALIDATION_FAILED');
      expect(JSON.stringify(response.body)).not.toContain(key);
      expect(repository.runsOf(characterId)).toHaveLength(0);
    },
  );

  it('rejects a character id that is not a UUID', async () => {
    const { token } = await provisionedPlayer();

    expectError((await fight(token, 'main').expect(400)).body, 'VALIDATION_FAILED');
  });

  it('ignores gameplay values in a request body: the server decides everything', async () => {
    const { token, characterId } = await provisionedPlayer();

    const response = await fight(token, characterId)
      .send({
        stage: '999',
        level: 500,
        seed: 'lucky',
        outcome: 'WIN',
        rewards: { gold: '1e99' },
      })
      .expect(201);
    const body = combatResponseSchema.parse(response.body);

    expect(body.combat.stage.number).toBe('1');
    expect(body.combat.rewards).toEqual({ gold: '5e0', experience: '3e0', item: null });
    expect(repository.runsOf(characterId)[0]?.seed).toBe('http-1');
  });
});

describe('combat — the loop over HTTP', () => {
  it('resolves a combat and returns the authoritative result and new state', async () => {
    const { token, characterId } = await provisionedPlayer();

    const response = await fight(token, characterId).expect(201);
    const body = combatResponseSchema.parse(response.body);

    expect(body.combat).toMatchObject({
      stage: { number: '1', kind: 'REGULAR' },
      enemy: { archetypeId: 'husk' },
      outcome: 'WIN',
      endReason: 'ENEMY_DEFEATED',
      rewards: { gold: '5e0', experience: '3e0' },
    });
    expect(body.combat.events.length).toBeGreaterThan(0);
    expect(body.before).toMatchObject({
      level: 1,
      gold: '0',
      experience: '0',
      currentStage: '1',
      highestStageReached: '1',
      highestStageCleared: null,
    });
    expect(body.after).toMatchObject({
      level: 1,
      gold: '5e0',
      experience: '3e0',
      currentStage: '2',
      highestStageReached: '2',
      highestStageCleared: '1',
    });
    expect(body.character).toMatchObject({ gold: '5e0', experience: '3e0' });
    expect(body.progression).toMatchObject({
      currentStage: '2',
      highestStageReached: '2',
      highestStageCleared: '1',
    });
    expect(body.progression.encounter?.stage).toEqual({ number: '2', kind: 'REGULAR' });

    const state = playerStateResponseSchema.parse(
      (
        await request(httpServer(app))
          .get('/player/state')
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(state.character).toMatchObject({ gold: '5e0' });
    expect(state.progression).toMatchObject({ currentStage: '2', highestStageCleared: '1' });
    expect(state.progression.nextCombatAt).toBe(body.progression.nextCombatAt);
  });

  it('never sends the seed, the idempotency key or the owner’s identity', async () => {
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();

    const response = await fight(token, characterId, key).expect(201);
    const text = JSON.stringify(response.body);

    expect(text).not.toContain('http-1');
    expect(text).not.toContain(key);
    expect(text).not.toMatch(/seed|authUserId|profileId|version/u);
  });

  it('replays the same idempotency key with 200 and the identical body', async () => {
    const { token, characterId } = await provisionedPlayer();
    const key = randomUUID();

    const first = await fight(token, characterId, key).expect(201);
    clock.advance(1);
    const second = await fight(token, characterId, key).expect(200);

    const { serverTime: _first, ...firstBody } = combatResponseSchema.parse(first.body);
    const { serverTime: _second, ...secondBody } = combatResponseSchema.parse(second.body);
    expect(secondBody).toEqual(firstBody);
    expect(repository.runsOf(characterId)).toHaveLength(1);
  });

  it('answers 409 COMBAT_NOT_READY with Retry-After while the hero is fighting', async () => {
    const { token, characterId } = await provisionedPlayer();
    const first = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    const early = await fight(token, characterId).expect(409);

    expectError(early.body, 'COMBAT_NOT_READY');
    expect(early.headers['retry-after']).toBe(String(Math.ceil(first.combat.durationMs / 1_000)));

    clock.advance(first.combat.durationMs);
    const next = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);
    expect(next.combat.stage.number).toBe('2');
  });

  it('shows the boss that Game Core places on the stage', async () => {
    const { token, characterId } = await provisionedPlayer();
    repository.updateCharacter(characterId, {
      stages: {
        current: StageNumber.of(10),
        highestReached: StageNumber.of(10),
        highestCleared: StageNumber.of(9),
      },
    });

    const body = combatResponseSchema.parse((await fight(token, characterId).expect(201)).body);

    expect(body.combat.stage).toEqual({ number: '10', kind: 'BOSS' });
    expect(body.combat.enemy.archetypeId).toBe('warden');
    expect(body.combat.outcome).toBe('LOSS');
    expect(body.combat.rewards).toEqual({ gold: '0', experience: '0', item: null });
    expect(body.after).toMatchObject({
      currentStage: '9',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
  });

  it('answers 409 STAGE_NOT_PLAYABLE on a valid stage the rules cannot scale', async () => {
    const { token, characterId } = await provisionedPlayer();
    const deep = StageNumber.of(STAGE_NUMBER_MAX);
    repository.updateCharacter(characterId, {
      stages: { current: deep, highestReached: deep, highestCleared: null },
    });

    const response = await fight(token, characterId).expect(409);

    expectError(response.body, 'STAGE_NOT_PLAYABLE');
    expect(response.headers['retry-after']).toBeUndefined();
    expect(repository.runsOf(characterId)).toHaveLength(0);
  });
});
