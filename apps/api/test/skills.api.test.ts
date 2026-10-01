import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { apiErrorResponseSchema, skillStateResponseSchema } from '@eternal-forge/contracts';
import { SKILL_LOADOUT_MAX_SIZE } from '@eternal-forge/game-core';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, httpServer } from './support/create-test-app.js';
import { InMemoryGameRepository } from './support/in-memory-game.repository.js';
import { InMemorySkillRepository } from './support/in-memory-skill.repository.js';
import { TestTokenIssuer } from './support/token-issuer.js';

/**
 * HTTP-level behaviour of the skill routes (ADR-032): authentication,
 * ownership, strict validation, error mapping and the absence of any public
 * grant or level-up route, through the real guard, verifier, controller and
 * exception filter. The PostgreSQL path — atomic replacement, concurrency,
 * snapshot reads and constraints — is in `test-integration/skills.int.test.ts`.
 */

let issuer: TestTokenIssuer;
let app: INestApplication;
let skills: InMemorySkillRepository;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
});

beforeEach(async () => {
  const game = new InMemoryGameRepository();
  skills = new InMemorySkillRepository();
  app = await createTestApp({ issuer, players: game, combats: game, selections: game, skills });
});

afterEach(async () => {
  await app.close();
});

async function player(owned: Record<string, number> = {}) {
  const sub = randomUUID();
  const characterId = skills.addCharacter(sub);
  await skills.grant(characterId, owned);
  return { token: await issuer.issue({ sub }), characterId };
}

function get(token: string | null, path: string) {
  const call = request(httpServer(app)).get(path);
  return token === null ? call : call.set('authorization', `Bearer ${token}`);
}

function put(token: string | null, path: string, body: unknown) {
  const call = request(httpServer(app))
    .put(path)
    .send(body as object);
  return token === null ? call : call.set('authorization', `Bearer ${token}`);
}

function expectError(body: unknown, code: string): void {
  expect(apiErrorResponseSchema.parse(body).code).toBe(code);
}

describe('GET /player/characters/:characterId/skills', () => {
  it('returns the intentional empty state for a character without skills', async () => {
    const { token, characterId } = await player();
    const response = await get(token, `/player/characters/${characterId}/skills`).expect(200);
    expect(skillStateResponseSchema.parse(response.body)).toEqual({
      characterVersion: '0',
      maxLoadoutSize: SKILL_LOADOUT_MAX_SIZE,
      owned: [],
      loadout: [],
    });
  });

  it('returns owned skills in catalog order and the loadout in priority order', async () => {
    const { token, characterId } = await player({ shield: 2, fireball: 1, execute: 3 });
    await put(token, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['shield', 'execute'],
    }).expect(200);
    const response = await get(token, `/player/characters/${characterId}/skills`).expect(200);
    const body = skillStateResponseSchema.parse(response.body);
    expect(body.owned).toEqual([
      { skillId: 'fireball', nameKey: 'skill.fireball.name', level: 1 },
      { skillId: 'execute', nameKey: 'skill.execute.name', level: 3 },
      { skillId: 'shield', nameKey: 'skill.shield.name', level: 2 },
    ]);
    expect(body.loadout).toEqual([
      { skillId: 'shield', nameKey: 'skill.shield.name', level: 2, priority: 0 },
      { skillId: 'execute', nameKey: 'skill.execute.name', level: 3, priority: 1 },
    ]);
    expect(body.characterVersion).toBe(skills.versionOf(characterId).toString());
  });

  it('requires authentication', async () => {
    const { characterId } = await player();
    const response = await get(null, `/player/characters/${characterId}/skills`).expect(401);
    expectError(response.body, 'UNAUTHENTICATED');
  });

  it('answers a foreign character exactly like a missing one', async () => {
    const owner = await player({ fireball: 1 });
    const other = await player();
    const foreign = await get(other.token, `/player/characters/${owner.characterId}/skills`);
    const missing = await get(other.token, `/player/characters/${randomUUID()}/skills`);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expectError(foreign.body, 'NOT_FOUND');
    expect(apiErrorResponseSchema.parse(foreign.body).error).toBe(
      apiErrorResponseSchema.parse(missing.body).error,
    );
  });

  it('rejects a malformed character id', async () => {
    const { token } = await player();
    expectError(
      (await get(token, '/player/characters/hero/skills').expect(400)).body,
      'VALIDATION_FAILED',
    );
  });

  it('fails without leaking detail when persisted state is corrupt', async () => {
    const { token, characterId } = await player();
    skills.storeRaw(characterId, { owned: { meteor: 1 } });
    const response = await get(token, `/player/characters/${characterId}/skills`).expect(500);
    expectError(response.body, 'INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('meteor');
  });
});

describe('PUT /player/characters/:characterId/skills/loadout', () => {
  it('sets the loadout and answers the new state', async () => {
    const { token, characterId } = await player({ fireball: 1, execute: 3, shield: 2 });
    const before = skills.versionOf(characterId);
    const response = await put(token, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['execute', 'fireball', 'shield'],
    }).expect(200);
    const body = skillStateResponseSchema.parse(response.body);
    expect(body.loadout.map((skill) => [skill.skillId, skill.level, skill.priority])).toEqual([
      ['execute', 3, 0],
      ['fireball', 1, 1],
      ['shield', 2, 2],
    ]);
    expect(body.characterVersion).toBe((before + 1n).toString());
  });

  it('repeating the same loadout is a no-op that keeps the version', async () => {
    const { token, characterId } = await player({ fireball: 1, execute: 3 });
    const path = `/player/characters/${characterId}/skills/loadout`;
    const first = await put(token, path, { skillIds: ['execute', 'fireball'] }).expect(200);
    const second = await put(token, path, { skillIds: ['execute', 'fireball'] }).expect(200);
    expect(second.body).toEqual(first.body);
    expect(skills.replacements).toBe(1);
  });

  it('accepts an empty loadout', async () => {
    const { token, characterId } = await player({ fireball: 1 });
    const path = `/player/characters/${characterId}/skills/loadout`;
    await put(token, path, { skillIds: ['fireball'] }).expect(200);
    const response = await put(token, path, { skillIds: [] }).expect(200);
    expect(skillStateResponseSchema.parse(response.body)).toMatchObject({
      loadout: [],
      owned: [{ skillId: 'fireball', level: 1 }],
    });
  });

  it.each([
    ['a malformed skill ID', { skillIds: ['Fireball'] }],
    ['a non-string entry', { skillIds: [7] }],
    ['a missing list', {}],
    [
      'too many skills',
      { skillIds: ['whirlwind', 'fireball', 'execute', 'blood_strike', 'shield'] },
    ],
    ['a duplicated skill', { skillIds: ['fireball', 'fireball'] }],
    ['a submitted level', { skillIds: ['fireball'], levels: [99] }],
    ['submitted priorities', { skillIds: ['fireball'], priorities: [0] }],
    ['an entry object with a level', { skillIds: [{ skillId: 'fireball', level: 99 }] }],
    ['a submitted cooldown', { skillIds: ['fireball'], cooldownMs: 1 }],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const { token, characterId } = await player({
      whirlwind: 1,
      fireball: 1,
      execute: 1,
      blood_strike: 1,
      shield: 1,
    });
    const version = skills.versionOf(characterId);
    const response = await put(
      token,
      `/player/characters/${characterId}/skills/loadout`,
      body,
    ).expect(400);
    expectError(response.body, 'VALIDATION_FAILED');
    expect(skills.versionOf(characterId)).toBe(version);
    expect(skills.replacements).toBe(0);
  });

  it('rejects a well-formed but unknown skill with 400', async () => {
    const { token, characterId } = await player({ fireball: 1 });
    const response = await put(token, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['meteor'],
    }).expect(400);
    expectError(response.body, 'VALIDATION_FAILED');
  });

  it('rejects a known skill the character does not own with 409 SKILL_NOT_OWNED', async () => {
    const { token, characterId } = await player({ fireball: 1 });
    const response = await put(token, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['fireball', 'shield'],
    }).expect(409);
    expectError(response.body, 'SKILL_NOT_OWNED');
    expect(skills.replacements).toBe(0);
  });

  it('refuses another player’s character as not found', async () => {
    const owner = await player({ fireball: 1 });
    const other = await player({ fireball: 1 });
    const response = await put(
      other.token,
      `/player/characters/${owner.characterId}/skills/loadout`,
      { skillIds: ['fireball'] },
    ).expect(404);
    expectError(response.body, 'NOT_FOUND');
    expect(skills.replacements).toBe(0);
  });

  it('requires authentication', async () => {
    const { characterId } = await player({ fireball: 1 });
    await put(null, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['fireball'],
    }).expect(401);
    expect(skills.replacements).toBe(0);
  });

  it('answers a character that keeps changing with 409 CONCURRENT_UPDATE', async () => {
    const { token, characterId } = await player({ fireball: 1 });
    let level = 1;
    skills.beforeReplace = async () => {
      level += 1;
      await skills.grant(characterId, { fireball: level });
    };
    const response = await put(token, `/player/characters/${characterId}/skills/loadout`, {
      skillIds: ['fireball'],
    }).expect(409);
    expectError(response.body, 'CONCURRENT_UPDATE');
  });
});

describe('no public ownership or level mutation', () => {
  it.each([
    ['post', '/skills/unlock'],
    ['post', '/skills/grant'],
    ['post', '/skills/level-up'],
    ['post', '/skills'],
    ['put', '/skills'],
    ['delete', '/skills'],
    ['patch', '/skills/loadout'],
    ['post', '/skills/loadout'],
  ] as const)('%s %s does not exist', async (method, suffix) => {
    const { token, characterId } = await player();
    const version = skills.versionOf(characterId);
    await request(httpServer(app))
      [method](`/player/characters/${characterId}${suffix}`)
      .set('authorization', `Bearer ${token}`)
      .send({ skillId: 'fireball', level: 99 })
      .expect(404);
    expect(skills.versionOf(characterId)).toBe(version);
  });
});
