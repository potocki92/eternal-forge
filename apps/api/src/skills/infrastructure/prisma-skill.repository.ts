import {
  SKILL_CATALOG,
  SkillDefinitionId,
  SkillLevel,
  createCharacterSkills,
} from '@eternal-forge/game-core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  ReplaceSkillLoadoutCommand,
  SkillRepository,
  TrustedSkillGrant,
} from '../application/ports/skill-repository.port.js';
import type { SkillState } from '../domain/skill-state.js';

/**
 * PostgreSQL implementation of {@link SkillRepository} (ADR-032).
 *
 * Ownership is in every statement: the character is read and written by id
 * *and* the verified `auth_user_id`. The composite foreign key from
 * `character_skill_loadout` to `character_skills` backs Game Core's
 * ownership check inside the database.
 */
@Injectable()
export class PrismaSkillRepository implements SkillRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prisma reads each relation with its own SELECT. Outside a transaction a
   * loadout replacement could commit between them and pair version N with
   * version N + 1's loadout. The read therefore runs in one REPEATABLE READ
   * transaction, as the inventory and stats reads do (ADR-030): it writes
   * nothing, takes no row lock and sees one committed state.
   */
  async loadSkillState(authUserId: string, characterId: string): Promise<SkillState | null> {
    const row = await this.prisma.client.$transaction(
      (transaction) =>
        transaction.character.findFirst({
          where: { id: characterId, profile: { authUserId } },
          select: {
            version: true,
            skills: {
              select: { skillDefinitionId: true, level: true },
              orderBy: { skillDefinitionId: 'asc' },
            },
            skillLoadout: {
              select: { position: true, skillDefinitionId: true },
              orderBy: { position: 'asc' },
            },
          },
        }),
      { isolationLevel: 'RepeatableRead' },
    );
    if (row === null) return null;

    row.skillLoadout.forEach((entry, index) => {
      if (entry.position !== index) {
        throw new Error(
          `Corrupt skill loadout for character ${characterId}: position ${String(entry.position)} at index ${String(index)}.`,
        );
      }
    });
    // Game Core refuses — never repairs — an unknown, duplicated or unowned
    // persisted skill, or an out-of-range level: corrupt authoritative state.
    const skills = createCharacterSkills({
      owned: row.skills.map((skill) => ({
        id: SkillDefinitionId.parse(skill.skillDefinitionId),
        level: SkillLevel.of(skill.level),
      })),
      loadout: row.skillLoadout.map((entry) => SkillDefinitionId.parse(entry.skillDefinitionId)),
    });
    return { version: row.version, skills };
  }

  /**
   * One transaction: the version-conditional, owner-scoped `UPDATE` first —
   * it takes the character's row lock, so no other write to this character
   * (combat, equipment, another loadout) can interleave — then every loadout
   * row is deleted and the new ones inserted at positions 0 … n − 1. A
   * concurrent replacement either commits entirely before or entirely after;
   * readers never see a half-written loadout.
   */
  async replaceLoadout(command: ReplaceSkillLoadoutCommand): Promise<'saved' | 'conflict'> {
    return this.prisma.client.$transaction(async (transaction) => {
      const changed = await transaction.character.updateMany({
        where: {
          id: command.characterId,
          version: command.expectedVersion,
          profile: { authUserId: command.authUserId },
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) return 'conflict';
      await transaction.characterSkillLoadoutEntry.deleteMany({
        where: { characterId: command.characterId },
      });
      if (command.loadout.length > 0) {
        await transaction.characterSkillLoadoutEntry.createMany({
          data: command.loadout.map((skillId, position) => ({
            characterId: command.characterId,
            position,
            skillDefinitionId: skillId.toString(),
          })),
        });
      }
      return 'saved';
    });
  }

  async saveTrustedSkill(grant: TrustedSkillGrant): Promise<void> {
    SKILL_CATALOG.require(grant.skillId);
    await this.prisma.client.$transaction(async (transaction) => {
      const changed = await transaction.character.updateMany({
        where: { id: grant.characterId },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error(`Character ${grant.characterId} does not exist.`);
      const key = {
        characterId: grant.characterId,
        skillDefinitionId: grant.skillId.toString(),
      };
      await transaction.characterSkill.upsert({
        where: { characterId_skillDefinitionId: key },
        create: { ...key, level: grant.level.toNumber() },
        update: { level: grant.level.toNumber() },
      });
    });
  }
}
