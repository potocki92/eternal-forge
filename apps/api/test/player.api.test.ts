import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorResponseSchema,
  characterResponseSchema,
  playerStateResponseSchema,
} from '@eternal-forge/contracts';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessTokenVerificationUnavailableError } from '../src/auth/application/ports/access-token-verifier.port.js';
import { createTestApp, httpServer } from './support/create-test-app.js';
import { InMemoryGameRepository } from './support/in-memory-game.repository.js';
import { TestTokenIssuer } from './support/token-issuer.js';

/**
 * HTTP-level authentication and authorization for the player endpoints.
 *
 * Runs without a database: the repository is in memory. Tokens are real JWTs
 * checked by the real verifier. The PostgreSQL path is covered in
 * `test-integration/`.
 */

let issuer: TestTokenIssuer;
let app: INestApplication;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
});

beforeEach(async () => {
  const repository = new InMemoryGameRepository();
  app = await createTestApp({ issuer, players: repository, combats: repository });
});

afterEach(async () => {
  await app.close();
});

const names = { displayName: 'Kael', characterName: 'Ember' };

async function provisionedPlayer(sub = randomUUID()) {
  const token = await issuer.issue({ sub });
  const response = await request(httpServer(app))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send(names)
    .expect(201);

  return { sub, token, state: playerStateResponseSchema.parse(response.body) };
}

function expectError(body: unknown, code: string): void {
  const error = apiErrorResponseSchema.parse(body);
  expect(error.code).toBe(code);
}

describe('authentication', () => {
  it('rejects a request without a token (401 + RFC 6750 challenge)', async () => {
    const response = await request(httpServer(app)).get('/player/state').expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(response.headers['www-authenticate']).toBe('Bearer realm="eternal-forge"');
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', 'Token abc')
      .expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(response.headers['www-authenticate']).toContain('error="invalid_request"');
  });

  it('rejects an invalid token', async () => {
    const stranger = await TestTokenIssuer.create();

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${await stranger.issue()}`)
      .expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('rejects an expired token', async () => {
    const { sub } = await provisionedPlayer();
    const expired = await issuer.issue({ sub, expiresInSeconds: -120 });

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${expired}`)
      .expect(401);

    expectError(response.body, 'UNAUTHENTICATED');
    expect(apiErrorResponseSchema.parse(response.body).error).toBe('The session has expired.');
  });

  it('never accepts a token from the query string', async () => {
    const token = await issuer.issue();

    await request(httpServer(app)).get(`/player/state?access_token=${token}`).expect(401);
  });

  it('never echoes the token in an error response', async () => {
    const expired = await issuer.issue({ expiresInSeconds: -120 });

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${expired}`);

    expect(JSON.stringify(response.body)).not.toContain(expired.split('.')[1]);
  });
});

describe('signing keys unavailable', () => {
  it('answers 503 AUTH_UNAVAILABLE with a retry hint, not 401', async () => {
    const outage = await createTestApp({
      issuer,
      players: new InMemoryGameRepository(),
      combats: new InMemoryGameRepository(),
      verifier: { verify: () => Promise.reject(new AccessTokenVerificationUnavailableError()) },
    });

    try {
      const response = await request(httpServer(outage))
        .get('/player/state')
        .set('authorization', `Bearer ${await issuer.issue()}`)
        .expect(503);

      expect(apiErrorResponseSchema.parse(response.body)).toMatchObject({
        code: 'AUTH_UNAVAILABLE',
        error: 'Sign-in cannot be verified right now. Please try again shortly.',
      });
      expect(response.headers['retry-after']).toBe('5');
    } finally {
      await outage.close();
    }
  });
});

describe('GET /player/state', () => {
  it('returns 404 PLAYER_NOT_PROVISIONED for a new account', async () => {
    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${await issuer.issue()}`)
      .expect(404);

    expectError(response.body, 'PLAYER_NOT_PROVISIONED');
  });

  it("returns the caller's state in the shared contract shape", async () => {
    const { token, state } = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(playerStateResponseSchema.parse(response.body)).toMatchObject({
      profile: { id: state.profile.id, displayName: 'Kael' },
      character: { name: 'Ember', level: 1, stage: '1' },
    });
  });

  it('does not expose the Supabase user id', async () => {
    const { sub, token } = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${token}`);

    expect(JSON.stringify(response.body)).not.toContain(sub);
  });
});

describe('impersonation attempts', () => {
  it('ignores identity fields in the query string', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get('/player/state')
      .query({ playerId: alice.state.profile.id, profileId: alice.state.profile.id })
      .set('authorization', `Bearer ${bob.token}`)
      .expect(200);

    expect(playerStateResponseSchema.parse(response.body).profile.id).toBe(bob.state.profile.id);
  });

  it('ignores identity headers a client might invent', async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${bob.token}`)
      .set('x-user-id', alice.sub)
      .set('x-player-id', alice.state.profile.id)
      .expect(200);

    expect(playerStateResponseSchema.parse(response.body).profile.id).toBe(bob.state.profile.id);
  });

  it('rejects identity fields in the provisioning body', async () => {
    const alice = await provisionedPlayer();

    const response = await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${await issuer.issue()}`)
      .send({ ...names, authUserId: alice.sub, profileId: alice.state.profile.id })
      .expect(400);

    expectError(response.body, 'VALIDATION_FAILED');
  });

  it("cannot read another player's character (indistinguishable from missing)", async () => {
    const alice = await provisionedPlayer();
    const bob = await provisionedPlayer();

    const foreign = await request(httpServer(app))
      .get(`/player/characters/${alice.state.character.id}`)
      .set('authorization', `Bearer ${bob.token}`)
      .expect(404);
    const missing = await request(httpServer(app))
      .get(`/player/characters/${randomUUID()}`)
      .set('authorization', `Bearer ${bob.token}`)
      .expect(404);

    const foreignError = apiErrorResponseSchema.parse(foreign.body);
    const missingError = apiErrorResponseSchema.parse(missing.body);
    expect(foreignError.code).toBe('NOT_FOUND');
    expect({ ...foreignError, requestId: undefined }).toEqual({
      ...missingError,
      requestId: undefined,
    });
  });

  it('can read its own character', async () => {
    const { token, state } = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get(`/player/characters/${state.character.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(characterResponseSchema.parse(response.body).character.id).toBe(state.character.id);
  });

  it('rejects a character id that is not a UUID', async () => {
    const { token } = await provisionedPlayer();

    const response = await request(httpServer(app))
      .get("/player/characters/1' OR '1'='1")
      .set('authorization', `Bearer ${token}`)
      .expect(400);

    expectError(response.body, 'VALIDATION_FAILED');
  });
});

describe('POST /player', () => {
  it('answers 201 on creation and 200 on a repeat, with the same player', async () => {
    const token = await issuer.issue();
    const post = () =>
      request(httpServer(app)).post('/player').set('authorization', `Bearer ${token}`).send(names);

    const first = await post().expect(201);
    const second = await post().expect(200);

    expect(playerStateResponseSchema.parse(second.body).profile.id).toBe(
      playerStateResponseSchema.parse(first.body).profile.id,
    );
  });

  it('reports invalid names per field without echoing the input', async () => {
    const response = await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${await issuer.issue()}`)
      .send({ displayName: '<script>', characterName: 'Ember' })
      .expect(400);

    const error = apiErrorResponseSchema.parse(response.body);
    expect(error.issues?.map((issue) => issue.path)).toEqual(['displayName']);
    expect(JSON.stringify(error)).not.toContain('<script>');
  });

  it('rejects a non-JSON body without quoting it back', async () => {
    const response = await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${await issuer.issue()}`)
      .set('content-type', 'application/json')
      .send('{"displayName": <img src=x>')
      .expect(400);

    expect(apiErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'VALIDATION_FAILED',
      error: 'Bad Request',
    });
    expect(JSON.stringify(response.body)).not.toContain('<img');
  });

  it('answers an unknown route with the error contract', async () => {
    const response = await request(httpServer(app))
      .get('/player/unknown')
      .set('authorization', `Bearer ${await issuer.issue()}`)
      .expect(404);

    expect(apiErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'NOT_FOUND',
      error: 'Not Found',
    });
  });
});
