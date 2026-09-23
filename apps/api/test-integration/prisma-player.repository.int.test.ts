import { randomUUID } from 'node:crypto';
import { STAGE_NUMBER_MAX, StageNumber } from '@eternal-forge/game-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProvisionPlayerData } from '../src/player/application/ports/player-repository.port.js';
import { PrismaPlayerRepository } from '../src/player/infrastructure/prisma-player.repository.js';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { connectTestDatabase, resetPlayerTables } from './database.js';

let prisma: PrismaService;
let repository: PrismaPlayerRepository;

beforeAll(() => {
  prisma = connectTestDatabase();
  repository = new PrismaPlayerRepository(prisma);
});

afterAll(async () => {
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  await resetPlayerTables(prisma);
});

function provisionData(
  authUserId = randomUUID(),
  names = { d: 'Kael', c: 'Ember' },
): ProvisionPlayerData {
  return {
    authUserId,
    displayName: names.d,
    characterName: names.c,
    characterSlot: 1,
    characterLevel: 1,
    characterStage: StageNumber.FIRST,
  };
}

async function countRows(): Promise<{ profiles: number; characters: number }> {
  return {
    profiles: await prisma.client.profile.count(),
    characters: await prisma.client.character.count(),
  };
}

describe('PrismaPlayerRepository — provisioning', () => {
  it('creates a profile and main character and reads them back', async () => {
    const data = provisionData();

    const outcome = await repository.provision(data);
    const found = await repository.findByAuthUserId(data.authUserId);

    expect(outcome.created).toBe(true);
    expect(found).toEqual(outcome.player);
    expect(found?.mainCharacter).toMatchObject({ slot: 1, level: 1, name: 'Ember' });
    expect(found?.mainCharacter.stage.toString()).toBe('1');
  });

  it('is idempotent: a retry changes nothing and reports created=false', async () => {
    const data = provisionData();

    const first = await repository.provision(data);
    const retry = await repository.provision({
      ...data,
      displayName: 'Changed',
      characterName: 'Changed',
    });

    expect(retry.created).toBe(false);
    expect(retry.player).toEqual(first.player);
    expect(await countRows()).toEqual({ profiles: 1, characters: 1 });
  });

  it('converges on one profile and one character under concurrent requests', async () => {
    const data = provisionData();

    const outcomes = await Promise.all(
      Array.from({ length: 25 }, () => repository.provision(data)),
    );

    expect(await countRows()).toEqual({ profiles: 1, characters: 1 });
    expect(new Set(outcomes.map((outcome) => outcome.player.profile.id)).size).toBe(1);
    expect(new Set(outcomes.map((outcome) => outcome.player.mainCharacter.id)).size).toBe(1);
    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
  });

  it('keeps concurrent provisioning of different users independent', async () => {
    const users = Array.from({ length: 10 }, () => randomUUID());

    await Promise.all(
      users.flatMap((user) => [
        repository.provision(provisionData(user)),
        repository.provision(provisionData(user)),
      ]),
    );

    expect(await countRows()).toEqual({ profiles: 10, characters: 10 });
  });

  it('repairs a profile left without its main character', async () => {
    const data = provisionData();
    await prisma.client.profile.create({
      data: { authUserId: data.authUserId, displayName: 'Kael' },
    });

    expect(await repository.findByAuthUserId(data.authUserId)).toBeNull();

    const outcome = await repository.provision(data);

    expect(outcome.created).toBe(true);
    expect(await countRows()).toEqual({ profiles: 1, characters: 1 });
  });
});

describe('PrismaPlayerRepository — ownership', () => {
  it('returns null for an identity without a profile', async () => {
    expect(await repository.findByAuthUserId(randomUUID())).toBeNull();
  });

  it("finds the caller's own character by id", async () => {
    const data = provisionData();
    const { player } = await repository.provision(data);

    const character = await repository.findOwnedCharacter(data.authUserId, player.mainCharacter.id);

    expect(character?.id).toBe(player.mainCharacter.id);
  });

  it("never returns another player's character", async () => {
    const alice = provisionData();
    const bob = provisionData(randomUUID(), { d: 'Bob', c: 'Frost' });
    const { player: alicePlayer } = await repository.provision(alice);
    await repository.provision(bob);

    expect(
      await repository.findOwnedCharacter(bob.authUserId, alicePlayer.mainCharacter.id),
    ).toBeNull();
  });
});

describe('schema constraints', () => {
  it('enforces one profile per Supabase user', async () => {
    const authUserId = randomUUID();
    await prisma.client.profile.create({ data: { authUserId, displayName: 'Kael' } });

    await expect(
      prisma.client.profile.create({ data: { authUserId, displayName: 'Other' } }),
    ).rejects.toThrow(/profiles_auth_user_id_key/u);
  });

  it('enforces one character per profile slot', async () => {
    const { player } = await repository.provision(provisionData());

    await expect(
      prisma.client.character.create({
        data: { profileId: player.profile.id, slot: 1, name: 'Second' },
      }),
    ).rejects.toThrow(/characters_profile_id_slot_key/u);
  });

  it('allows further slots without a schema change', async () => {
    const { player } = await repository.provision(provisionData());

    await prisma.client.character.create({
      data: { profileId: player.profile.id, slot: 2, name: 'Alt' },
    });

    expect(await prisma.client.character.count()).toBe(2);
  });

  it.each([
    [
      'a too-short display name',
      `INSERT INTO profiles (auth_user_id, display_name, updated_at) VALUES (gen_random_uuid(), 'ab', now())`,
    ],
    [
      'a padded display name',
      `INSERT INTO profiles (auth_user_id, display_name, updated_at) VALUES (gen_random_uuid(), ' Kael', now())`,
    ],
  ])('rejects %s at the database', async (_label, sql) => {
    await expect(prisma.client.$executeRawUnsafe(sql)).rejects.toThrow(
      /profiles_display_name_check/u,
    );
  });

  it.each([
    ['level 0', 'level', '0'],
    ['stage 0', 'stage', '0'],
    ['slot 0', 'slot', '0'],
  ])('rejects a character with %s', async (_label, column, value) => {
    const constraint = new RegExp(`characters_${column}_check`, 'u');
    const { player } = await repository.provision(provisionData());

    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE characters SET ${column} = ${value} WHERE id = '${player.mainCharacter.id}'`,
      ),
    ).rejects.toThrow(constraint);
  });

  it.each([
    ['beyond the 32-bit range', 5_000_000_000n],
    ['beyond the safe-integer range', 2n ** 53n + 1n],
    ['at the bigint maximum', STAGE_NUMBER_MAX],
  ])('reads a stage %s back exactly', async (_label, stored) => {
    const data = provisionData();
    const { player } = await repository.provision(data);
    await prisma.client.character.update({
      where: { id: player.mainCharacter.id },
      data: { stage: stored },
    });

    const found = await repository.findByAuthUserId(data.authUserId);
    const owned = await repository.findOwnedCharacter(data.authUserId, player.mainCharacter.id);

    expect(found?.mainCharacter.stage.toBigInt()).toBe(stored);
    expect(owned?.stage.toBigInt()).toBe(stored);
  });

  it('writes the provisioned stage as a bigint', async () => {
    const data = { ...provisionData(), characterStage: StageNumber.of(2n ** 53n + 1n) };

    await repository.provision(data);

    const [row] = await prisma.client.$queryRawUnsafe<{ stage: bigint }[]>(
      'SELECT stage FROM characters',
    );
    expect(row?.stage).toBe(2n ** 53n + 1n);
  });

  it.each([
    ['a negative stage', '-1'],
    ['a stage above the bigint maximum', '9223372036854775808'],
  ])('rejects %s at the database', async (_label, value) => {
    const { player } = await repository.provision(provisionData());

    await expect(
      prisma.client.$executeRawUnsafe(
        `UPDATE characters SET stage = ${value} WHERE id = '${player.mainCharacter.id}'`,
      ),
    ).rejects.toThrow(/characters_stage_check|out of range/u);
  });

  it('deletes characters with their profile', async () => {
    const data = provisionData();
    await repository.provision(data);

    await prisma.client.profile.delete({ where: { authUserId: data.authUserId } });

    expect(await countRows()).toEqual({ profiles: 0, characters: 0 });
  });
});

describe('row level security', () => {
  it('is enabled on every player table', async () => {
    const rows = await prisma.client.$queryRawUnsafe<
      { relname: string; relrowsecurity: boolean }[]
    >(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('profiles', 'characters') ORDER BY relname`,
    );

    expect(rows).toEqual([
      { relname: 'characters', relrowsecurity: true },
      { relname: 'profiles', relrowsecurity: true },
    ]);
  });

  it('denies a non-owner role by default, even with table privileges', async () => {
    await repository.provision(provisionData());
    const role = 'ef_rls_probe';

    const visible = await prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT SELECT ON profiles, characters TO ${role}`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      const [profiles] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) FROM profiles',
      );
      const [characters] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) FROM characters',
      );
      await tx.$executeRawUnsafe('RESET ROLE');
      await tx.$executeRawUnsafe(`REVOKE ALL ON profiles, characters FROM ${role}`);
      await tx.$executeRawUnsafe(`DROP ROLE ${role}`);
      return { profiles: profiles?.count, characters: characters?.count };
    });

    expect(visible).toEqual({ profiles: 0n, characters: 0n });
  });
});
