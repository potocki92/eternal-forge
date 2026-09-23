import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  SaveStageSelection,
  SaveStageSelectionResult,
  StageSelectionRepository,
  VersionedCharacter,
} from '../application/ports/stage-selection-repository.port.js';
import { toCharacter } from './prisma-player.repository.js';

/**
 * PostgreSQL implementation of {@link StageSelectionRepository} (ADR-021).
 *
 * The save is one statement: `UPDATE characters SET current_stage, stage_mode,
 * version = version + 1 WHERE id AND version AND owner RETURNING *`. Under READ
 * COMMITTED a concurrent combat commit blocks it on the row lock, after which
 * the version no longer matches and nothing is written — the same mechanism
 * that serialises combats (ADR-019 §5). The CHECK `current_stage ≤
 * highest_stage_reached` backs Game Core's validation.
 */
@Injectable()
export class PrismaStageSelectionRepository implements StageSelectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadOwnedCharacter(
    authUserId: string,
    characterId: string,
  ): Promise<VersionedCharacter | null> {
    const row = await this.prisma.client.character.findFirst({
      where: { id: characterId, profile: { authUserId } },
    });
    return row === null ? null : { character: toCharacter(row), version: row.version };
  }

  async saveSelection(command: SaveStageSelection): Promise<SaveStageSelectionResult> {
    const rows = await this.prisma.client.character.updateManyAndReturn({
      where: {
        id: command.characterId,
        version: command.expectedVersion,
        profile: { authUserId: command.authUserId },
      },
      // Only the position and the mode. The records, rewards and pacing gate
      // are not part of a selection and are not written.
      data: {
        currentStage: command.currentStage.toBigInt(),
        stageMode: command.stageMode,
        version: { increment: 1 },
      },
    });
    const row = rows[0];
    return row === undefined
      ? { kind: 'conflict' }
      : { kind: 'saved', character: toCharacter(row) };
  }
}
