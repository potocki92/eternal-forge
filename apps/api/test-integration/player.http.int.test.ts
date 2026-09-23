import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { playerStateResponseSchema } from '@eternal-forge/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { PrismaPlayerRepository } from '../src/player/infrastructure/prisma-player.repository.js';
import { createPlayerTestApp, httpServer } from '../test/support/create-test-app.js';
import { TestTokenIssuer } from '../test/support/token-issuer.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';

/**
 * The full request path against PostgreSQL: HTTP → guard → controller → use
 * case → Prisma repository → database.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let app: INestApplication;

beforeAll(async () => {
  prisma = connectTestDatabase();
  issuer = await TestTokenIssuer.create();
  app = await createPlayerTestApp({ issuer, repository: new PrismaPlayerRepository(prisma) });
});

afterAll(async () => {
  await app.close();
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  await resetPlayerTables(prisma);
});

const names = { displayName: 'Kael', characterName: 'Ember' };

describe('player API against PostgreSQL', () => {
  it('provisions once under a burst of concurrent requests from one account', async () => {
    const token = await issuer.issue({ sub: randomUUID() });

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(httpServer(app))
          .post('/player')
          .set('authorization', `Bearer ${token}`)
          .send(names),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(await prisma.client.profile.count()).toBe(1);
    expect(await prisma.client.character.count()).toBe(1);
  });

  it('serves the provisioned state and isolates accounts', async () => {
    const alice = await issuer.issue({ sub: randomUUID() });
    const bob = await issuer.issue({ sub: randomUUID() });
    await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${alice}`)
      .send(names)
      .expect(201);
    await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${bob}`)
      .send({ displayName: 'Bob', characterName: 'Frost' })
      .expect(201);

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${bob}`)
      .expect(200);
    const state = playerStateResponseSchema.parse(response.body);

    expect(state.profile.displayName).toBe('Bob');

    const aliceState = playerStateResponseSchema.parse(
      (await request(httpServer(app)).get('/player/state').set('authorization', `Bearer ${alice}`))
        .body,
    );
    await request(httpServer(app))
      .get(`/player/characters/${aliceState.character.id}`)
      .set('authorization', `Bearer ${bob}`)
      .expect(404);
  });

  it('serves a stage beyond 2^53 exactly, as a canonical string', async () => {
    const sub = randomUUID();
    const token = await issuer.issue({ sub });
    await request(httpServer(app))
      .post('/player')
      .set('authorization', `Bearer ${token}`)
      .send(names)
      .expect(201);
    await prisma.client.character.updateMany({
      where: { profile: { authUserId: sub } },
      data: { stage: 9_223_372_036_854_775_807n },
    });

    const response = await request(httpServer(app))
      .get('/player/state')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.text).toContain('"stage":"9223372036854775807"');
    expect(playerStateResponseSchema.parse(response.body).character.stage).toBe(
      '9223372036854775807',
    );
  });
});
