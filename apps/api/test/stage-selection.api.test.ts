import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { StageNumber } from '@eternal-forge/game-core';
import {
  apiErrorResponseSchema,
  combatResponseSchema,
  playerStateResponseSchema,
  stageSelectionResponseSchema,
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
 * HTTP-level behaviour of `PUT /player/characters/:characterId/stage-selection`
 * (ADR-021): authentication, ownership, validation and tampering, through the
 * real guard, verifier, controller and exception filter. The PostgreSQL path
 * is covered in `test-integration/`.
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
    seeds: sequentialSeeds('select-http'),
    clock,
  });
});

afterEach(async () => {
  await app.close();
});

/** A provisioned player whose hero reached the stage-10 boss and cleared stage 9. */
async function provisionedPlayer() {
  const token = await issuer.issue({ sub: randomUUID(), now: clock.now() });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const state = playerStateResponseSchema.parse(response.body);
  repository.updateCharacter(state.character.id, {
    level: 60,
    stages: {
      current: StageNumber.of(9),
      highestReached: StageNumber.of(10),
      highestCleared: StageNumber.of(9),
    },
  });
  return { token, characterId: state.character.id };
}

function put(token: string | null, characterId: string, body: unknown) {
  const call = request(httpServer(app)).put(`/player/characters/${characterId}/stage-selection`);
  return (token === null ? call : call.set('authorization', `Bearer ${token}`)).send(
    body as object,
  );
}

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}

async function stateOf(token: string) {
  const response = await request(httpServer(app))
    .get('/player/state')
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return playerStateResponseSchema.parse(response.body).progression;
}

describe('stage selection — success', () => {
  it('selects an unlocked farm stage and returns the authoritative state', async () => {
    const { token, characterId } = await provisionedPlayer();

    const response = await put(token, characterId, { mode: 'FARM', stage: '4' }).expect(200);
    const body = stageSelectionResponseSchema.parse(response.body);

    expect(body.progression).toMatchObject({
      stageMode: 'FARM',
      currentStage: '4',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
    expect(body.progression.encounter?.stage).toEqual({ number: '4', kind: 'REGULAR' });
    expect(body.character.id).toBe(characterId);
    expect(await stateOf(token)).toMatchObject({ stageMode: 'FARM', currentStage: '4' });
  });

  it('returns to climbing from the frontier', async () => {
    const { token, characterId } = await provisionedPlayer();
    await put(token, characterId, { mode: 'FARM', stage: '2' }).expect(200);

    const response = await put(token, characterId, { mode: 'PROGRESS' }).expect(200);

    expect(stageSelectionResponseSchema.parse(response.body).progression).toMatchObject({
      stageMode: 'PROGRESS',
      currentStage: '10',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
  });

  it('is idempotent: the same request twice gives the same state', async () => {
    const { token, characterId } = await provisionedPlayer();

    const first = await put(token, characterId, { mode: 'FARM', stage: '3' }).expect(200);
    const second = await put(token, characterId, { mode: 'FARM', stage: '3' }).expect(200);

    const parse = (body: unknown) => stageSelectionResponseSchema.parse(body).progression;
    expect(parse(second.body)).toEqual(parse(first.body));
  });

  it('the next combat is fought on the farmed stage, and stays there', async () => {
    const { token, characterId } = await provisionedPlayer();
    await put(token, characterId, { mode: 'FARM', stage: '9' }).expect(200);

    const response = await request(httpServer(app))
      .post(`/player/characters/${characterId}/combats`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .expect(201);
    const combat = combatResponseSchema.parse(response.body);

    expect(combat.combat.stage.number).toBe('9');
    expect(combat.combat.outcome).toBe('WIN');
    expect(combat.combat.rewards.gold).not.toBe('0');
    expect(combat.progression).toMatchObject({
      stageMode: 'FARM',
      currentStage: '9',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
  });
});

describe('stage selection — authentication', () => {
  it('rejects a request without a token', async () => {
    const { characterId } = await provisionedPlayer();

    const response = await put(null, characterId, { mode: 'FARM', stage: '1' }).expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
  });

  it('rejects an expired token', async () => {
    const { characterId } = await provisionedPlayer();
    const expired = await issuer.issue({ expiresInSeconds: -120, now: clock.now() });

    expectError(
      (await put(expired, characterId, { mode: 'PROGRESS' }).expect(401)).body,
      'UNAUTHENTICATED',
    );
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

    const response = await put(`${header ?? ''}.${forged}.${signature ?? ''}`, characterId, {
      mode: 'FARM',
      stage: '1',
    }).expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
  });
});

describe('stage selection — authorization', () => {
  it('player A cannot change player B’s selection', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();

    const response = await put(alice.token, bob.characterId, { mode: 'FARM', stage: '1' }).expect(
      404,
    );

    expectError(response.body, 'NOT_FOUND');
    expect(await stateOf(bob.token)).toMatchObject({ stageMode: 'PROGRESS', currentStage: '9' });
  });

  it('answers 404 for a character that does not exist', async () => {
    const { token } = await provisionedPlayer();

    expectError(
      (await put(token, randomUUID(), { mode: 'PROGRESS' }).expect(404)).body,
      'NOT_FOUND',
    );
  });

  it('rejects a malformed character id', async () => {
    const { token } = await provisionedPlayer();

    expectError(
      (await put(token, 'not-a-uuid', { mode: 'PROGRESS' }).expect(400)).body,
      'VALIDATION_FAILED',
    );
  });
});

describe('stage selection — locked stages', () => {
  it.each(['11', '999999', '9007199254740993', '9223372036854775807'])(
    'refuses stage %s with 409 STAGE_LOCKED and changes nothing',
    async (stage) => {
      const { token, characterId } = await provisionedPlayer();

      const response = await put(token, characterId, { mode: 'FARM', stage }).expect(409);

      expectError(response.body, 'STAGE_LOCKED');
      expect(apiErrorResponseSchema.parse(response.body).error).toBe(
        'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
      );
      expect(await stateOf(token)).toMatchObject({
        stageMode: 'PROGRESS',
        currentStage: '9',
        highestStageReached: '10',
        highestStageCleared: '9',
      });
    },
  );
});

describe('stage selection — validation and tampering', () => {
  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['an unknown mode', { mode: 'CLIMB' }],
    ['a malformed mode', { mode: 42 }],
    ['a farm without a stage', { mode: 'FARM' }],
    ['a numeric stage', { mode: 'FARM', stage: 4 }],
    ['stage zero', { mode: 'FARM', stage: '0' }],
    ['a negative stage', { mode: 'FARM', stage: '-3' }],
    ['a fractional stage', { mode: 'FARM', stage: '2.5' }],
    ['an exponent', { mode: 'FARM', stage: '1e2' }],
    ['a stage beyond 2^63 − 1', { mode: 'FARM', stage: '9223372036854775808' }],
    ['a 5 000-digit stage', { mode: 'FARM', stage: '9'.repeat(5_000) }],
    ['a stage while climbing', { mode: 'PROGRESS', stage: '999999' }],
    ['a forged record', { mode: 'FARM', stage: '2', highestStageReached: '999999' }],
    ['a forged clear', { mode: 'PROGRESS', highestStageCleared: '999999' }],
    ['a forged reward', { mode: 'FARM', stage: '2', gold: '1e300' }],
    ['a forged owner', { mode: 'PROGRESS', authUserId: randomUUID() }],
  ])('rejects %s with 400 and changes nothing', async (_label, body) => {
    const { token, characterId } = await provisionedPlayer();

    const response = await put(token, characterId, body).expect(400);

    expectError(response.body, 'VALIDATION_FAILED');
    // The received value is never echoed back.
    expect(JSON.stringify(response.body)).not.toContain('999999');
    expect(await stateOf(token)).toMatchObject({
      stageMode: 'PROGRESS',
      currentStage: '9',
      highestStageReached: '10',
      highestStageCleared: '9',
    });
  });

  it('refuses a body larger than the server accepts without touching the character', async () => {
    const { token, characterId } = await provisionedPlayer();

    const response = await put(token, characterId, {
      mode: 'FARM',
      stage: '2',
      padding: 'x'.repeat(2_000_000),
    });

    expect(response.status).toBe(413);
    expect(apiErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'HTTP_ERROR',
      error: 'Payload Too Large',
    });
    expect(await stateOf(token)).toMatchObject({ stageMode: 'PROGRESS', currentStage: '9' });
  });
});
