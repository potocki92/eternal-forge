import { isUniqueConstraintViolation } from '@eternal-forge/database';
import { HugeNumber, StageNumber } from '@eternal-forge/game-core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { toCharacter } from '../../player/infrastructure/prisma-player.repository.js';
import { toStageProgress } from '../../player/infrastructure/stage-progress.columns.js';
import type {
  CommitOfflineClaim,
  CommitOfflineClaimResult,
  OfflineClaimTarget,
  OfflineProgressRepository,
} from '../application/ports/offline-progress-repository.port.js';
import type { OfflineRun } from '../domain/offline-run.js';

/** Row shape this adapter reads. Declared locally so Prisma types stop here. */
interface OfflineRunRow {
  readonly id: string;
  readonly characterId: string;
  readonly idempotencyKey: string;
  readonly rulesVersion: number;
  readonly seed: string;
  readonly idleSince: Date;
  readonly rewardedFrom: Date;
  readonly processedUntil: Date;
  readonly currentStage: bigint;
  readonly highestStageReached: bigint;
  readonly highestStageCleared: bigint;
  readonly characterLevel: number;
  readonly experienceBeforeCoef: bigint;
  readonly experienceBeforeExp: number;
  readonly goldBeforeCoef: bigint;
  readonly goldBeforeExp: number;
  readonly targetStage: bigint;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly levelsGained: number;
  readonly rewardGoldCoef: bigint;
  readonly rewardGoldExp: number;
  readonly rewardExperienceCoef: bigint;
  readonly rewardExperienceExp: number;
  readonly createdAt: Date;
}

/** Thrown inside the transaction to roll it back when the version moved on. */
class StaleCharacterVersion extends Error {}

/**
 * PostgreSQL implementation of {@link OfflineProgressRepository} (ADR-023).
 *
 * The same optimistic concurrency as a combat (ADR-019 §5): the character
 * update carries `version = expected` and the owner in its WHERE clause, and
 * the claim record is inserted in the same transaction. A concurrent combat,
 * selection or claim that commits first leaves this one matching no row, and
 * nothing of it is written. The simulation happened before the transaction.
 */
@Injectable()
export class PrismaOfflineProgressRepository implements OfflineProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadClaimTarget(
    authUserId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<OfflineClaimTarget | null> {
    const row = await this.prisma.client.character.findFirst({
      where: { id: characterId, profile: { authUserId } },
      include: { offlineRuns: { where: { idempotencyKey } } },
    });
    if (row === null) {
      return null;
    }
    const existing = row.offlineRuns[0];

    return {
      character: toCharacter(row),
      version: row.version,
      offlineSeed: row.offlineSeed,
      existingRun: existing === undefined ? null : toOfflineRun(existing),
    };
  }

  async commitClaim(command: CommitOfflineClaim): Promise<CommitOfflineClaimResult> {
    const { run } = command;
    const experience = command.experience.toParts();
    const gold = command.gold.toParts();
    const experienceBefore = run.before.experience.toParts();
    const goldBefore = run.before.gold.toParts();
    const rewardGold = run.rewards.gold.toParts();
    const rewardExperience = run.rewards.experience.toParts();
    const cleared = run.before.stages.highestCleared;
    if (cleared === null) {
      throw new Error('An offline claim that fought always has a cleared stage.');
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.character.updateManyAndReturn({
          where: {
            id: command.characterId,
            version: command.expectedVersion,
            profile: { authUserId: command.authUserId },
          },
          // Level, experience, gold, the processed boundary and the next seed.
          // Never a stage, the stage mode or a record: offline farming does
          // not move them (ADR-023).
          data: {
            level: command.level,
            experienceCoef: experience.coefficient,
            experienceExp: experience.exponent,
            goldCoef: gold.coefficient,
            goldExp: gold.exponent,
            nextCombatAt: command.processedUntil,
            offlineSeed: command.nextOfflineSeed,
            version: { increment: 1 },
          },
        });
        const character = updated[0];
        if (updated.length !== 1 || character === undefined) {
          throw new StaleCharacterVersion();
        }

        const row = await tx.offlineRun.create({
          data: {
            characterId: run.characterId,
            idempotencyKey: run.idempotencyKey,
            rulesVersion: run.rulesVersion,
            seed: run.seed,
            idleSince: run.idleSince,
            rewardedFrom: run.rewardedFrom,
            processedUntil: run.processedUntil,
            currentStage: run.before.stages.current.toBigInt(),
            highestStageReached: run.before.stages.highestReached.toBigInt(),
            highestStageCleared: cleared.toBigInt(),
            characterLevel: run.before.level,
            experienceBeforeCoef: experienceBefore.coefficient,
            experienceBeforeExp: experienceBefore.exponent,
            goldBeforeCoef: goldBefore.coefficient,
            goldBeforeExp: goldBefore.exponent,
            targetStage: run.targetStage.toBigInt(),
            fights: run.fights,
            wins: run.wins,
            losses: run.losses,
            levelsGained: run.levelsGained,
            rewardGoldCoef: rewardGold.coefficient,
            rewardGoldExp: rewardGold.exponent,
            rewardExperienceCoef: rewardExperience.coefficient,
            rewardExperienceExp: rewardExperience.exponent,
            createdAt: run.claimedAt,
          },
        });

        return {
          kind: 'committed',
          run: toOfflineRun(row),
          character: toCharacter(character),
        } as const;
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

function toOfflineRun(row: OfflineRunRow): OfflineRun {
  return {
    id: row.id,
    characterId: row.characterId,
    idempotencyKey: row.idempotencyKey,
    rulesVersion: row.rulesVersion,
    seed: row.seed,
    idleSince: row.idleSince,
    rewardedFrom: row.rewardedFrom,
    processedUntil: row.processedUntil,
    claimedAt: row.createdAt,
    before: {
      level: row.characterLevel,
      stages: toStageProgress(row),
      experience: HugeNumber.fromParts(row.experienceBeforeCoef, row.experienceBeforeExp),
      gold: HugeNumber.fromParts(row.goldBeforeCoef, row.goldBeforeExp),
    },
    targetStage: StageNumber.of(row.targetStage),
    fights: row.fights,
    wins: row.wins,
    losses: row.losses,
    levelsGained: row.levelsGained,
    rewards: {
      gold: HugeNumber.fromParts(row.rewardGoldCoef, row.rewardGoldExp),
      experience: HugeNumber.fromParts(row.rewardExperienceCoef, row.rewardExperienceExp),
    },
  };
}
