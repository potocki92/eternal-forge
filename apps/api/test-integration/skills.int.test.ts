import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  combatResponseSchema,
  playerStateResponseSchema,
  skillStateResponseSchema,
  type SkillStateResponse,
} from '@eternal-forge/contracts';
import { GAME_RULES_VERSION, SkillDefinitionId, SkillLevel } from '@eternal-forge/game-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaCombatRepository } from '../src/combat/infrastructure/prisma-combat.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { PrismaPlayerRepository } from '../src/player/infrastructure/prisma-player.repository.js';
import { PrismaStageSelectionRepository } from '../src/player/infrastructure/prisma-stage-selection.repository.js';
import type { SkillState } from '../src/skills/domain/skill-state.js';
import { PrismaSkillRepository } from '../src/skills/infrastructure/prisma-skill.repository.js';
import { toSkillStateResponse } from '../src/skills/presentation/skill.mapper.js';
import { createTestApp, httpServer, sequentialSeeds } from '../test/support/create-test-app.js';
import { TestTokenIssuer } from '../test/support/token-issuer.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';
import { StatementGate } from './statement-gate.js';

/**
 * Active skill source state against PostgreSQL (ADR-032): persistence,
 * ownership enforced by the database, atomic whole-loadout replacement,
 * optimistic concurrency through `characters.version`, one-snapshot reads,
 * constraints, RLS — and that skills do not change combat yet.
 */

let prisma: PrismaService;
let issuer: TestTokenIssuer;
let app: INestApplication;
let skills: PrismaSkillRepository;
const gate = new StatementGate();

function appWith(seedPrefix?: string): Promise<INestApplication> {
  return createTestApp({
    issuer,
    players: new PrismaPlayerRepository(prisma),
    combats: new PrismaCombatRepository(prisma),
    selections: new PrismaStageSelectionRepository(prisma),
    skills: new PrismaSkillRepository(prisma),
    ...(seedPrefix === undefined ? {} : { seeds: sequentialSeeds(seedPrefix) }),
  });
}

beforeAll(async () => {
  prisma = connectTestDatabase();
  issuer = await TestTokenIssuer.create();
  gate.install();
});

afterAll(async () => {
  gate.uninstall();
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  await resetPlayerTables(prisma);
  skills = new PrismaSkillRepository(prisma);
  app = await appWith();
});

afterEach(async () => {
  await app.close();
});

async function provisionedPlayer(application: INestApplication = app) {
  const authUserId = randomUUID();
  const token = await issuer.issue({ sub: authUserId });
  const response = await request(httpServer(application))
    .post('/player')
    .set('authorization', `Bearer ${token}`)
    .send({ displayName: 'Kael', characterName: 'Ember' })
    .expect(201);
  const characterId = playerStateResponseSchema.parse(response.body).character.id;
  return { authUserId, token, characterId };
}

/** Trusted fixture: grants skills at their levels through the repository. */
async function grant(characterId: string, owned: Record<string, number>): Promise<void> {
  for (const [id, level] of Object.entries(owned)) {
    await skills.saveTrustedSkill({
      characterId,
      skillId: SkillDefinitionId.parse(id),
      level: SkillLevel.of(level),
    });
  }
}

async function getSkills(token: string, characterId: string): Promise<SkillStateResponse> {
  const response = await request(httpServer(app))
    .get(`/player/characters/${characterId}/skills`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return skillStateResponseSchema.parse(response.body);
}

function putLoadout(token: string, characterId: string, skillIds: readonly string[]) {
  return request(httpServer(app))
    .put(`/player/characters/${characterId}/skills/loadout`)
    .set('authorization', `Bearer ${token}`)
    .send({ skillIds });
}

async function versionOf(characterId: string): Promise<bigint> {
  return (await prisma.client.character.findUniqueOrThrow({ where: { id: characterId } })).version;
}

async function loadoutRows(characterId: string) {
  return prisma.client.characterSkillLoadoutEntry.findMany({
    where: { characterId },
    orderBy: { position: 'asc' },
    select: { position: true, skillDefinitionId: true },
  });
}

const ids = (values: readonly string[]) => values.map((value) => SkillDefinitionId.parse(value));

describe('skill state persistence', () => {
  it('a new character starts with no skills and an empty loadout — nothing is granted', async () => {
    const { token, characterId } = await provisionedPlayer();
    expect(await getSkills(token, characterId)).toMatchObject({ owned: [], loadout: [] });
    expect(await prisma.client.characterSkill.count()).toBe(0);
    expect(await prisma.client.characterSkillLoadoutEntry.count()).toBe(0);
  });

  it('trusted grants persist ownership and levels, and every change advances the version', async () => {
    const { token, characterId } = await provisionedPlayer();
    const before = await versionOf(characterId);
    await grant(characterId, { fireball: 1, execute: 3 });
    expect(await versionOf(characterId)).toBe(before + 2n);
    await grant(characterId, { fireball: 5 });
    expect(await versionOf(characterId)).toBe(before + 3n);

    const state = await getSkills(token, characterId);
    expect(state.owned).toEqual([
      { skillId: 'fireball', nameKey: 'skill.fireball.name', level: 5 },
      { skillId: 'execute', nameKey: 'skill.execute.name', level: 3 },
    ]);
    expect(state.characterVersion).toBe((before + 3n).toString());
    expect(await prisma.client.characterSkill.count({ where: { characterId } })).toBe(2);
  });

  it('a trusted grant of an unknown skill writes nothing', async () => {
    const { characterId } = await provisionedPlayer();
    const before = await versionOf(characterId);
    await expect(grant(characterId, { meteor: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_SKILL_DEFINITION',
    });
    expect(await versionOf(characterId)).toBe(before);
    expect(await prisma.client.characterSkill.count()).toBe(0);
  });

  it('persists the loadout at positions 0 … n − 1 in priority order and reads it back exactly', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3, shield: 2 });
    const before = await versionOf(characterId);

    const response = await putLoadout(token, characterId, ['execute', 'fireball', 'shield']).expect(
      200,
    );
    const written = skillStateResponseSchema.parse(response.body);
    expect(written.loadout.map((skill) => [skill.priority, skill.skillId, skill.level])).toEqual([
      [0, 'execute', 3],
      [1, 'fireball', 1],
      [2, 'shield', 2],
    ]);
    expect(written.characterVersion).toBe((before + 1n).toString());
    expect(await versionOf(characterId)).toBe(before + 1n);
    expect(await loadoutRows(characterId)).toEqual([
      { position: 0, skillDefinitionId: 'execute' },
      { position: 1, skillDefinitionId: 'fireball' },
      { position: 2, skillDefinitionId: 'shield' },
    ]);
    // The answer of the command is exactly what a fresh read returns.
    expect(await getSkills(token, characterId)).toEqual(written);
  });

  it('replaces the whole loadout, empties it, and leaves ownership untouched', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3, shield: 2, lightning_chain: 1 });
    await putLoadout(token, characterId, ['execute', 'fireball', 'shield']).expect(200);
    await putLoadout(token, characterId, ['lightning_chain', 'fireball']).expect(200);
    expect(await loadoutRows(characterId)).toEqual([
      { position: 0, skillDefinitionId: 'lightning_chain' },
      { position: 1, skillDefinitionId: 'fireball' },
    ]);
    await putLoadout(token, characterId, []).expect(200);
    expect(await loadoutRows(characterId)).toEqual([]);
    expect(await prisma.client.characterSkill.count({ where: { characterId } })).toBe(4);
  });

  it('repeating the same loadout writes nothing and keeps the version', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3 });
    await putLoadout(token, characterId, ['execute', 'fireball']).expect(200);
    const version = await versionOf(characterId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await putLoadout(token, characterId, ['execute', 'fireball']).expect(200);
      expect(skillStateResponseSchema.parse(response.body).characterVersion).toBe(
        version.toString(),
      );
    }
    expect(await versionOf(characterId)).toBe(version);
    expect(await prisma.client.characterSkillLoadoutEntry.count({ where: { characterId } })).toBe(
      2,
    );
  });

  it('refuses unowned and unknown skills and writes nothing', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1 });
    await putLoadout(token, characterId, ['fireball']).expect(200);
    const version = await versionOf(characterId);
    await putLoadout(token, characterId, ['shield', 'fireball']).expect(409);
    await putLoadout(token, characterId, ['meteor']).expect(400);
    await putLoadout(token, characterId, ['Fireball']).expect(400);
    expect(await versionOf(characterId)).toBe(version);
    expect(await loadoutRows(characterId)).toEqual([
      { position: 0, skillDefinitionId: 'fireball' },
    ]);
  });

  it('another player cannot read or change a character’s skills', async () => {
    const owner = await provisionedPlayer();
    const other = await provisionedPlayer();
    await grant(owner.characterId, { fireball: 1 });
    const version = await versionOf(owner.characterId);
    await request(httpServer(app))
      .get(`/player/characters/${owner.characterId}/skills`)
      .set('authorization', `Bearer ${other.token}`)
      .expect(404);
    await putLoadout(other.token, owner.characterId, ['fireball']).expect(404);
    expect(await versionOf(owner.characterId)).toBe(version);
    expect(await loadoutRows(owner.characterId)).toEqual([]);
  });

  it('fails explicitly on corrupt persisted state instead of repairing it', async () => {
    const { authUserId, characterId } = await provisionedPlayer();
    // Well-formed (the CHECK accepts it) but not in the catalog.
    await prisma.client.characterSkill.create({
      data: { characterId, skillDefinitionId: 'meteor', level: 1 },
    });
    await expect(skills.loadSkillState(authUserId, characterId)).rejects.toMatchObject({
      code: 'UNKNOWN_SKILL_DEFINITION',
    });

    const second = await provisionedPlayer();
    await grant(second.characterId, { fireball: 1, execute: 1 });
    // A hole in the positions cannot be written by the application.
    await prisma.client.characterSkillLoadoutEntry.createMany({
      data: [
        { characterId: second.characterId, position: 0, skillDefinitionId: 'fireball' },
        { characterId: second.characterId, position: 2, skillDefinitionId: 'execute' },
      ],
    });
    await expect(skills.loadSkillState(second.authUserId, second.characterId)).rejects.toThrow(
      /Corrupt skill loadout/u,
    );
  });
});

describe('concurrency through characters.version', () => {
  it('two concurrent replacements at one version: exactly one commits, never a mixture', async () => {
    const { authUserId, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3, shield: 2, whirlwind: 1 });
    const version = await versionOf(characterId);
    const first = new PrismaSkillRepository(prisma);
    const second = new PrismaSkillRepository(prisma);
    const a = ['execute', 'fireball', 'shield'];
    const b = ['whirlwind', 'shield'];

    const results = await Promise.all([
      first.replaceLoadout({ authUserId, characterId, expectedVersion: version, loadout: ids(a) }),
      second.replaceLoadout({ authUserId, characterId, expectedVersion: version, loadout: ids(b) }),
    ]);

    expect([...results].sort()).toEqual(['conflict', 'saved']);
    const winner = results[0] === 'saved' ? a : b;
    expect((await loadoutRows(characterId)).map((row) => row.skillDefinitionId)).toEqual(winner);
    expect(await versionOf(characterId)).toBe(version + 1n);
  });

  it('many concurrent PUTs settle on exactly one requested loadout', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3, shield: 2, whirlwind: 1, blood_strike: 1 });
    const requests = [
      ['execute', 'fireball', 'shield'],
      ['whirlwind', 'shield'],
      ['blood_strike', 'execute', 'whirlwind', 'fireball'],
      ['shield'],
      [],
      ['fireball', 'blood_strike'],
    ];
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        putLoadout(token, characterId, requests[index % requests.length] ?? []),
      ),
    );

    for (const response of responses) expect([200, 409]).toContain(response.status);
    const final = (await loadoutRows(characterId)).map((row) => row.skillDefinitionId);
    expect(requests).toContainEqual(final);
    (await loadoutRows(characterId)).forEach((row, index) => {
      expect(row.position).toBe(index);
    });
    // Every 200 answer was a real, complete loadout at the version it names.
    for (const response of responses.filter((candidate) => candidate.status === 200)) {
      const body = skillStateResponseSchema.parse(response.body);
      expect(requests).toContainEqual(body.loadout.map((skill) => skill.skillId));
    }
  });

  it('a combat committed after the read makes a stale replacement a conflict', async () => {
    const { authUserId, token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1 });
    const stale = await skills.loadSkillState(authUserId, characterId);
    if (stale === null) throw new Error('The character must exist.');
    await request(httpServer(app))
      .post(`/player/characters/${characterId}/combats`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .expect(201);

    expect(
      await skills.replaceLoadout({
        authUserId,
        characterId,
        expectedVersion: stale.version,
        loadout: ids(['fireball']),
      }),
    ).toBe('conflict');
    expect(await loadoutRows(characterId)).toEqual([]);
  });

  it('a failed insert rolls back the version increment and the delete', async () => {
    const { authUserId, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1 });
    const state = await skills.loadSkillState(authUserId, characterId);
    if (state === null) throw new Error('The character must exist.');
    await skills.replaceLoadout({
      authUserId,
      characterId,
      expectedVersion: state.version,
      loadout: ids(['fireball']),
    });
    // Bypassing Game Core: the composite foreign key refuses an unowned skill.
    await expect(
      skills.replaceLoadout({
        authUserId,
        characterId,
        expectedVersion: state.version + 1n,
        loadout: ids(['shield']),
      }),
    ).rejects.toThrow();
    expect(await versionOf(characterId)).toBe(state.version + 1n);
    expect(await loadoutRows(characterId)).toEqual([
      { position: 0, skillDefinitionId: 'fireball' },
    ]);
  });
});

describe('one-snapshot read', () => {
  function wire(state: SkillState | null): SkillStateResponse {
    if (state === null) throw new Error('The character must exist.');
    return toSkillStateResponse(state);
  }

  it('never pairs one version with another version’s loadout, at any statement boundary', async () => {
    const { authUserId, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 3, shield: 2, whirlwind: 4 });
    const read = () => skills.loadSkillState(authUserId, characterId);
    const statements = await gate.record(read);
    expect(statements.length).toBeGreaterThan(2);

    let loadout = ['execute', 'fireball', 'shield'];
    await skills.replaceLoadout({
      authUserId,
      characterId,
      expectedVersion: await versionOf(characterId),
      loadout: ids(loadout),
    });
    for (let index = 0; index < statements.length; index += 1) {
      const before = wire(await read());
      const next =
        loadout.length === 3 ? ['whirlwind', 'shield'] : ['execute', 'fireball', 'shield'];
      const answer = wire(
        await gate.pauseBefore(index, read, async () => {
          await skills.replaceLoadout({
            authUserId,
            characterId,
            expectedVersion: BigInt(before.characterVersion),
            loadout: ids(next),
          });
        }),
      );
      loadout = next;
      const after = wire(await read());
      expect(after.characterVersion).toBe((BigInt(before.characterVersion) + 1n).toString());
      expect([before, after]).toContainEqual(answer);
    }
  });
});

describe('database constraints', () => {
  async function owner() {
    const { characterId } = await provisionedPlayer();
    return characterId;
  }

  it('refuses level 0 and a malformed skill ID', async () => {
    const characterId = await owner();
    await expect(
      prisma.client.characterSkill.create({
        data: { characterId, skillDefinitionId: 'fireball', level: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.client.characterSkill.create({
        data: { characterId, skillDefinitionId: 'Fire-Ball', level: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.client.characterSkill.create({
        data: { characterId, skillDefinitionId: 'fireball', level: 2_147_483_647 },
      }),
    ).resolves.toBeDefined();
  });

  it('refuses an unowned, duplicated, foreign or negative-position loadout entry', async () => {
    const characterId = await owner();
    const otherCharacterId = await owner();
    await grant(characterId, { fireball: 1, execute: 1 });
    await grant(otherCharacterId, { shield: 1 });
    const entry = (position: number, skillDefinitionId: string, character = characterId) =>
      prisma.client.characterSkillLoadoutEntry.create({
        data: { characterId: character, position, skillDefinitionId },
      });

    await expect(entry(0, 'shield')).rejects.toThrow(); // owned only by another character
    await expect(entry(-1, 'fireball')).rejects.toThrow();
    await entry(0, 'fireball');
    await expect(entry(1, 'fireball')).rejects.toThrow(); // same skill twice
    await expect(entry(0, 'execute')).rejects.toThrow(); // same position twice
    await expect(entry(0, 'fireball', otherCharacterId)).rejects.toThrow();
  });

  it('refuses to delete the ownership of an equipped skill', async () => {
    const characterId = await owner();
    await grant(characterId, { fireball: 1, execute: 1 });
    await prisma.client.characterSkillLoadoutEntry.create({
      data: { characterId, position: 0, skillDefinitionId: 'fireball' },
    });
    await expect(
      prisma.client.characterSkill.delete({
        where: { characterId_skillDefinitionId: { characterId, skillDefinitionId: 'fireball' } },
      }),
    ).rejects.toThrow();
    // An unequipped skill can be removed by a trusted system.
    await prisma.client.characterSkill.delete({
      where: { characterId_skillDefinitionId: { characterId, skillDefinitionId: 'execute' } },
    });
  });

  it('deleting the character removes its skills and loadout in one statement', async () => {
    const { token, characterId } = await provisionedPlayer();
    await grant(characterId, { fireball: 1, execute: 1 });
    await putLoadout(token, characterId, ['execute', 'fireball']).expect(200);
    await prisma.client.character.delete({ where: { id: characterId } });
    expect(await prisma.client.characterSkill.count({ where: { characterId } })).toBe(0);
    expect(await prisma.client.characterSkillLoadoutEntry.count({ where: { characterId } })).toBe(
      0,
    );
  });

  it.each(['character_skills', 'character_skill_loadout'])(
    'row level security on %s is enabled and denies a non-owner role',
    async (table) => {
      const { token, characterId } = await provisionedPlayer();
      await grant(characterId, { fireball: 1 });
      await putLoadout(token, characterId, ['fireball']).expect(200);
      const role = 'ef_rls_skill_probe';
      const [enabled] = await prisma.client.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = '${table}'`,
      );
      const visible = await prisma.client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
        await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
        await tx.$executeRawUnsafe(`GRANT SELECT ON ${table} TO ${role}`);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        const [rows] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) FROM ${table}`,
        );
        await tx.$executeRawUnsafe('RESET ROLE');
        await tx.$executeRawUnsafe(`REVOKE ALL ON ${table} FROM ${role}`);
        await tx.$executeRawUnsafe(`DROP ROLE ${role}`);
        return rows?.count;
      });
      expect(enabled?.relrowsecurity).toBe(true);
      expect(visible).toBe(0n);
    },
  );
});

describe('skills do not affect combat yet', () => {
  it('a character with an equipped loadout fights exactly like one without', async () => {
    const withSkillsApp = await appWith('same-seed');
    const withoutSkillsApp = await appWith('same-seed');
    try {
      const armed = await provisionedPlayer(withSkillsApp);
      const bare = await provisionedPlayer(withoutSkillsApp);
      await grant(armed.characterId, { fireball: 5, execute: 3, shield: 2, whirlwind: 1 });
      await request(httpServer(withSkillsApp))
        .put(`/player/characters/${armed.characterId}/skills/loadout`)
        .set('authorization', `Bearer ${armed.token}`)
        .send({ skillIds: ['execute', 'fireball', 'shield', 'whirlwind'] })
        .expect(200);

      const fight = async (application: INestApplication, token: string, characterId: string) =>
        combatResponseSchema.parse(
          (
            await request(httpServer(application))
              .post(`/player/characters/${characterId}/combats`)
              .set('authorization', `Bearer ${token}`)
              .set('idempotency-key', randomUUID())
              .expect(201)
          ).body,
        );
      const withSkills = await fight(withSkillsApp, armed.token, armed.characterId);
      const withoutSkills = await fight(withoutSkillsApp, bare.token, bare.characterId);

      const { id: _armedId, resolvedAt: _armedAt, ...armedCombat } = withSkills.combat;
      const { id: _bareId, resolvedAt: _bareAt, ...bareCombat } = withoutSkills.combat;
      expect(armedCombat).toEqual(bareCombat);
      expect(withSkills.after).toEqual(withoutSkills.after);

      const run = await prisma.client.combatRun.findUniqueOrThrow({
        where: { id: withSkills.combat.id },
      });
      expect(run.rulesVersion).toBe(GAME_RULES_VERSION);
      expect(GAME_RULES_VERSION).toBe(3);
      // The combat advanced the version but left the loadout as configured.
      expect((await loadoutRows(armed.characterId)).map((row) => row.skillDefinitionId)).toEqual([
        'execute',
        'fireball',
        'shield',
        'whirlwind',
      ]);
    } finally {
      await withSkillsApp.close();
      await withoutSkillsApp.close();
    }
  });
});
