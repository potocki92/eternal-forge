import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  PlayerRepository,
  ProvisionPlayerData,
  ProvisionPlayerOutcome,
} from '../application/ports/player-repository.port.js';
import {
  MAIN_CHARACTER_SLOT,
  type Character,
  type Player,
  type Profile,
} from '../domain/player.js';

/** Row shapes this adapter reads. Declared locally so Prisma types stop here. */
interface ProfileRow {
  readonly id: string;
  readonly authUserId: string;
  readonly displayName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CharacterRow {
  readonly id: string;
  readonly profileId: string;
  readonly slot: number;
  readonly name: string;
  readonly level: number;
  readonly stage: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * PostgreSQL implementation of {@link PlayerRepository}.
 *
 * Ownership is part of every query's WHERE clause, not a check after loading.
 */
@Injectable()
export class PrismaPlayerRepository implements PlayerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByAuthUserId(authUserId: string): Promise<Player | null> {
    const row = await this.prisma.client.profile.findUnique({
      where: { authUserId },
      include: { characters: { where: { slot: MAIN_CHARACTER_SLOT } } },
    });
    const character = row?.characters[0];

    // A profile without its main character is incompletely provisioned; the
    // client re-runs provisioning, which repairs it.
    if (row == null || character === undefined) {
      return null;
    }

    return { profile: toProfile(row), mainCharacter: toCharacter(character) };
  }

  async findOwnedCharacter(authUserId: string, characterId: string): Promise<Character | null> {
    const row = await this.prisma.client.character.findFirst({
      where: { id: characterId, profile: { authUserId } },
    });

    return row === null ? null : toCharacter(row);
  }

  /**
   * `INSERT … ON CONFLICT DO NOTHING` for the profile, then for the main
   * character, then reads both back — in one transaction.
   *
   * Under READ COMMITTED, a concurrent transaction inserting the same unique key
   * blocks until the first commits and then skips its own insert, and the
   * following read sees the committed row. The unique constraints on
   * `profiles.auth_user_id` and `characters (profile_id, slot)` are what make
   * this correct; no advisory lock or retry loop is needed.
   */
  async provision(data: ProvisionPlayerData): Promise<ProvisionPlayerOutcome> {
    return this.prisma.client.$transaction(async (tx) => {
      const insertedProfiles = await tx.profile.createMany({
        data: [{ authUserId: data.authUserId, displayName: data.displayName }],
        skipDuplicates: true,
      });
      const profile = await tx.profile.findUniqueOrThrow({
        where: { authUserId: data.authUserId },
      });

      const insertedCharacters = await tx.character.createMany({
        data: [
          {
            profileId: profile.id,
            slot: data.characterSlot,
            name: data.characterName,
            level: data.characterLevel,
            stage: BigInt(data.characterStage),
          },
        ],
        skipDuplicates: true,
      });
      const character = await tx.character.findUniqueOrThrow({
        where: { profileId_slot: { profileId: profile.id, slot: data.characterSlot } },
      });

      return {
        player: { profile: toProfile(profile), mainCharacter: toCharacter(character) },
        created: insertedProfiles.count > 0 || insertedCharacters.count > 0,
      };
    });
  }
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    authUserId: row.authUserId,
    displayName: row.displayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    profileId: row.profileId,
    slot: row.slot,
    name: row.name,
    level: row.level,
    stage: toSafeInteger(row.stage),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The column is bigint so the schema has no stage ceiling; the domain works in
 * safe integers. A value beyond 2^53 − 1 is refused rather than rounded.
 */
function toSafeInteger(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Stored stage exceeds the safe-integer range.');
  }
  return Number(value);
}
