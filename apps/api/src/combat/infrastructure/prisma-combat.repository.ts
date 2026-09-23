import { isUniqueConstraintViolation } from '@eternal-forge/database';
import { HugeNumber, type StageMode } from '@eternal-forge/game-core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { toCharacter } from '../../player/infrastructure/prisma-player.repository.js';
import {
  toStageProgress,
  toStageProgressColumns,
} from '../../player/infrastructure/stage-progress.columns.js';
import type {
  CombatRepository,
  CombatTarget,
  CommitCombat,
  CommitCombatResult,
} from '../application/ports/combat-repository.port.js';
import type { CombatRun } from '../domain/combat-run.js';

/** Row shape this adapter reads. Declared locally so Prisma types stop here. */
interface CombatRunRow {
  readonly id: string;
  readonly characterId: string;
  readonly idempotencyKey: string;
  readonly rulesVersion: number;
  readonly seed: string;
  /** The stage actually fought. */
  readonly stage: bigint;
  readonly highestStageReachedBefore: bigint;
  readonly highestStageClearedBefore: bigint | null;
  readonly stageMode: StageMode;
  readonly characterLevel: number;
  readonly experienceBeforeCoef: bigint;
  readonly experienceBeforeExp: number;
  readonly goldBeforeCoef: bigint;
  readonly goldBeforeExp: number;
  readonly outcome: 'WIN' | 'LOSS';
  readonly endReason: 'ENEMY_DEFEATED' | 'PLAYER_DEFEATED' | 'TIME_LIMIT';
  readonly durationMs: number;
  readonly rewardGoldCoef: bigint;
  readonly rewardGoldExp: number;
  readonly rewardExperienceCoef: bigint;
  readonly rewardExperienceExp: number;
  readonly createdAt: Date;
}

/** Thrown inside the transaction to roll it back when the version moved on. */
class StaleCharacterVersion extends Error {}

/**
 * PostgreSQL implementation of {@link CombatRepository} (ADR-019).
 *
 * Concurrency is optimistic. The character update carries `version =
 * expected` in its WHERE clause. Under READ COMMITTED a concurrent writer
 * blocks on the row lock, then re-evaluates that condition against the
 * committed row and matches nothing. The transaction is two statements; the
 * simulation happened before it began.
 */
@Injectable()
export class PrismaCombatRepository implements CombatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadTarget(
    authUserId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<CombatTarget | null> {
    const row = await this.prisma.client.character.findFirst({
      where: { id: characterId, profile: { authUserId } },
      include: { combatRuns: { where: { idempotencyKey } } },
    });
    if (row === null) {
      return null;
    }
    const existing = row.combatRuns[0];

    return {
      character: toCharacter(row),
      version: row.version,
      existingRun: existing === undefined ? null : toCombatRun(existing),
    };
  }

  async commit(command: CommitCombat): Promise<CommitCombatResult> {
    const { progress, run } = command;
    const experience = progress.experience.toParts();
    const gold = progress.gold.toParts();
    const experienceBefore = run.before.experience.toParts();
    const goldBefore = run.before.gold.toParts();
    const rewardGold = run.rewards.gold.toParts();
    const rewardExperience = run.rewards.experience.toParts();

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.character.updateMany({
          // Ownership again, as defence in depth: the version came from an
          // owner-scoped read, but the write does not rely on that.
          where: {
            id: command.characterId,
            version: command.expectedVersion,
            profile: { authUserId: command.authUserId },
          },
          data: {
            level: progress.level,
            ...toStageProgressColumns(progress.stages),
            experienceCoef: experience.coefficient,
            experienceExp: experience.exponent,
            goldCoef: gold.coefficient,
            goldExp: gold.exponent,
            nextCombatAt: command.nextCombatAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new StaleCharacterVersion();
        }

        const row = await tx.combatRun.create({
          data: {
            characterId: run.characterId,
            idempotencyKey: run.idempotencyKey,
            rulesVersion: run.rulesVersion,
            seed: run.seed,
            stage: run.before.stages.current.toBigInt(),
            highestStageReachedBefore: run.before.stages.highestReached.toBigInt(),
            highestStageClearedBefore: run.before.stages.highestCleared?.toBigInt() ?? null,
            stageMode: run.stageMode,
            characterLevel: run.before.level,
            experienceBeforeCoef: experienceBefore.coefficient,
            experienceBeforeExp: experienceBefore.exponent,
            goldBeforeCoef: goldBefore.coefficient,
            goldBeforeExp: goldBefore.exponent,
            outcome: run.outcome,
            endReason: run.endReason,
            durationMs: run.durationMs,
            rewardGoldCoef: rewardGold.coefficient,
            rewardGoldExp: rewardGold.exponent,
            rewardExperienceCoef: rewardExperience.coefficient,
            rewardExperienceExp: rewardExperience.exponent,
            createdAt: run.resolvedAt,
          },
        });

        return { kind: 'committed', run: toCombatRun(row) } as const;
      });
    } catch (error) {
      // Both mean another request committed first; nothing of ours was written.
      if (error instanceof StaleCharacterVersion || isUniqueConstraintViolation(error)) {
        return { kind: 'conflict' };
      }
      throw error;
    }
  }
}

function toCombatRun(row: CombatRunRow): CombatRun {
  return {
    id: row.id,
    characterId: row.characterId,
    idempotencyKey: row.idempotencyKey,
    rulesVersion: row.rulesVersion,
    seed: row.seed,
    before: {
      level: row.characterLevel,
      stages: toStageProgress({
        currentStage: row.stage,
        highestStageReached: row.highestStageReachedBefore,
        highestStageCleared: row.highestStageClearedBefore,
      }),
      experience: HugeNumber.fromParts(row.experienceBeforeCoef, row.experienceBeforeExp),
      gold: HugeNumber.fromParts(row.goldBeforeCoef, row.goldBeforeExp),
    },
    stageMode: row.stageMode,
    outcome: row.outcome,
    endReason: row.endReason,
    durationMs: row.durationMs,
    rewards: {
      gold: HugeNumber.fromParts(row.rewardGoldCoef, row.rewardGoldExp),
      experience: HugeNumber.fromParts(row.rewardExperienceCoef, row.rewardExperienceExp),
    },
    resolvedAt: row.createdAt,
  };
}
