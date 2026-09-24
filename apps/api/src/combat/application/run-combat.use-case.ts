import {
  GAME_RULES_VERSION,
  experienceToNextLevel,
  getGameRules,
  resolveStageAttempt,
  resolveItemDrop,
  type CharacterProgress,
  type HugeNumber,
  type StageAttemptResult,
} from '@eternal-forge/game-core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';
import { progressOf, type Character } from '../../player/domain/player.js';
import { viewProgression, type ProgressionView } from '../../player/domain/progression-view.js';
import { recordAttempt, replayMatches, type CombatRun } from '../domain/combat-run.js';
import {
  COMBAT_REPOSITORY,
  type CombatRepository,
  type CombatTarget,
} from './ports/combat-repository.port.js';
import { COMBAT_SEED_SOURCE, type CombatSeedSource } from './ports/combat-seed-source.port.js';

export interface RunCombatCommand {
  readonly characterId: string;
  /** One player intent. Validated as a UUID at the transport boundary. */
  readonly idempotencyKey: string;
}

/** Progress at one instant, with the requirement the rules derive from it. */
export interface ProgressSnapshot extends CharacterProgress {
  readonly experienceToNextLevel: HugeNumber;
}

export interface ResolvedCombat {
  readonly run: CombatRun;
  /** The full Game Core result, including the event timeline. */
  readonly attempt: StageAttemptResult;
  readonly before: ProgressSnapshot;
  readonly after: ProgressSnapshot;
  /** The character as this combat left it. */
  readonly character: Character;
  /** Derived values after this combat: the next encounter and the pacing gate. */
  readonly progression: ProgressionView;
}

export type RunCombatResult =
  | {
      readonly kind: 'resolved';
      /** True when the key already had a result and nothing new was written. */
      readonly replayed: boolean;
      readonly combat: ResolvedCombat;
      readonly serverTime: Date;
    }
  | { readonly kind: 'not-found' }
  /**
   * The current stage is a valid stage number, but the rule set cannot scale
   * an enemy for it (a HugeNumber `OVERFLOW`, ADR-018). Nothing is written.
   */
  | { readonly kind: 'stage-not-playable' }
  | { readonly kind: 'not-ready'; readonly nextCombatAt: Date; readonly serverTime: Date };

/** Re-running a stored combat did not reproduce it. Always a defect. */
export class CombatReplayMismatchError extends Error {
  constructor(readonly combatId: string) {
    super(`Replaying combat ${combatId} did not reproduce its recorded result.`);
    this.name = 'CombatReplayMismatchError';
  }
}

/**
 * Command: resolve the caller's character's next combat (ADR-019).
 *
 * The client names only the character and an idempotency key. The stage,
 * enemy, seed, outcome, rewards and new progress are all decided here, by Game
 * Core, from persisted state. The whole flow:
 *
 * 1. Load the owned character, its version and any combat already recorded
 *    under this key — one owner-scoped read. The stage and the stage mode
 *    come from this persisted state (ADR-020, ADR-021), never the request.
 * 2. A recorded combat is replayed: same result, nothing written.
 * 3. A character still fighting (server clock before `nextCombatAt`) is refused.
 * 4. A stage the rule set cannot scale is refused before any seed is drawn.
 * 5. A fresh CSPRNG seed; `resolveStageAttempt` decides everything else.
 * 6. One conditional transaction writes the new progress and the combat
 *    record, only if the version is unchanged.
 * 7. On a conflict, the key is looked up again: a concurrent retry of this
 *    request is replayed; any other winner means this request was too late.
 *
 * Every path that does not resolve a new combat is logged as a structured
 * event (`combat.replayed`, `combat.not_ready`, `combat.conflict`,
 * `combat.stage_not_playable`) with the character id and, where relevant, the
 * combat id. They are what an online auto-battle loop, several tabs or a
 * flaky connection produce, and what explains a player's "it refused to
 * fight". No token, seed or request body is ever logged. `combat.not_ready`
 * is at debug level: a spamming client produces one per request.
 */
@Injectable()
export class RunCombatUseCase {
  private readonly logger = new Logger(RunCombatUseCase.name);

  constructor(
    @Inject(COMBAT_REPOSITORY) private readonly combats: CombatRepository,
    @Inject(COMBAT_SEED_SOURCE) private readonly seeds: CombatSeedSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    command: RunCombatCommand,
  ): Promise<RunCombatResult> {
    const target = await this.load(identity, command);
    if (target === null) {
      return { kind: 'not-found' };
    }
    if (target.existingRun !== null) {
      return this.replay(target.character, target.existingRun, 'retry');
    }

    const now = this.clock.now();
    if (now < target.character.nextCombatAt) {
      this.logger.debug({
        msg: 'Combat refused: the hero is still fighting',
        event: 'combat.not_ready',
        characterId: target.character.id,
        retryAfterMs: target.character.nextCombatAt.getTime() - now.getTime(),
      });
      return { kind: 'not-ready', nextCombatAt: target.character.nextCombatAt, serverTime: now };
    }
    if (viewProgression(target.character).encounter === null) {
      this.logger.warn({
        msg: 'Combat refused: the rule set cannot scale this stage',
        event: 'combat.stage_not_playable',
        characterId: target.character.id,
        stage: target.character.stages.current.toString(),
      });
      return { kind: 'stage-not-playable' };
    }

    const attempt = resolveStageAttempt({
      progress: progressOf(target.character),
      // The persisted choice, never a request value: the client cannot pick
      // the stage or the mode of this combat (ADR-021).
      mode: target.character.stageMode,
      seed: this.seeds.next(),
      rulesVersion: GAME_RULES_VERSION,
    });
    const nextCombatAt = new Date(now.getTime() + attempt.combat.durationMs);
    const itemDrop = resolveItemDrop({
      combatSeed: attempt.seed,
      rulesVersion: attempt.rulesVersion,
      stage: attempt.stage.number,
      outcome: attempt.combat.outcome,
    });

    const committed = await this.combats.commit({
      authUserId: identity.authUserId,
      characterId: target.character.id,
      expectedVersion: target.version,
      progress: attempt.after,
      nextCombatAt,
      run: recordAttempt(attempt, {
        characterId: target.character.id,
        idempotencyKey: command.idempotencyKey,
        stageMode: target.character.stageMode,
        resolvedAt: now,
      }),
      itemDrop,
    });

    if (committed.kind === 'conflict') {
      return this.afterConflict(identity, command);
    }

    if (committed.run.awardedItem === null) {
      this.logger.debug({
        msg: 'Combat resolved without an item drop',
        event: 'item.drop_none',
        characterId: target.character.id,
        combatId: committed.run.id,
        stage: attempt.stage.number.toString(),
      });
    } else {
      this.logger.log({
        msg: 'Combat item drop awarded',
        event: 'item.drop_awarded',
        characterId: target.character.id,
        combatId: committed.run.id,
        itemInstanceId: committed.run.awardedItem.id.toString(),
        definitionId: committed.run.awardedItem.definitionId.toString(),
        rarity: committed.run.awardedItem.rarity,
        stage: attempt.stage.number.toString(),
      });
    }

    return {
      kind: 'resolved',
      replayed: false,
      combat: resolved(committed.run, attempt, target.character, nextCombatAt),
      serverTime: now,
    };
  }

  private load(
    identity: AuthenticatedIdentity,
    command: RunCombatCommand,
  ): Promise<CombatTarget | null> {
    return this.combats.loadTarget(
      identity.authUserId,
      command.characterId,
      command.idempotencyKey,
    );
  }

  /**
   * Someone else committed first. If it was this same request (a retry that
   * raced its original), serve that result. Otherwise the character is now
   * busy with the winner's combat.
   */
  private async afterConflict(
    identity: AuthenticatedIdentity,
    command: RunCombatCommand,
  ): Promise<RunCombatResult> {
    const fresh = await this.load(identity, command);
    if (fresh === null) {
      return { kind: 'not-found' };
    }
    this.logger.log({
      msg: 'Combat lost a concurrent write',
      event: 'combat.conflict',
      characterId: fresh.character.id,
      resolution: fresh.existingRun === null ? 'not_ready' : 'replayed',
    });
    if (fresh.existingRun !== null) {
      return this.replay(fresh.character, fresh.existingRun, 'race');
    }
    return {
      kind: 'not-ready',
      nextCombatAt: fresh.character.nextCombatAt,
      serverTime: this.clock.now(),
    };
  }

  /**
   * The recorded combat, regenerated from its stored inputs. Determinism
   * makes the timeline identical to the one first returned; the stored summary
   * proves it.
   */
  private replay(character: Character, run: CombatRun, cause: 'retry' | 'race'): RunCombatResult {
    this.logger.log({
      msg: 'Combat replayed for a repeated idempotency key',
      event: 'combat.replayed',
      characterId: character.id,
      combatId: run.id,
      cause,
    });
    const attempt = resolveStageAttempt({
      progress: run.before,
      mode: run.stageMode,
      seed: run.seed,
      rulesVersion: run.rulesVersion,
    });
    if (!replayMatches(run, attempt)) {
      throw new CombatReplayMismatchError(run.id);
    }
    const replayedDrop = resolveItemDrop({
      combatSeed: run.seed,
      rulesVersion: run.rulesVersion,
      stage: run.before.stages.current,
      outcome: run.outcome,
    });
    const persistedDrop = run.awardedItem;
    if (
      (replayedDrop === null) !== (persistedDrop === null) ||
      (replayedDrop !== null &&
        persistedDrop !== null &&
        (!replayedDrop.definitionId.equals(persistedDrop.definitionId) ||
          replayedDrop.rarity !== persistedDrop.rarity))
    ) {
      throw new CombatReplayMismatchError(run.id);
    }
    if (persistedDrop !== null) {
      this.logger.log({
        msg: 'Combat item drop replayed',
        event: 'item.drop_replay',
        characterId: character.id,
        combatId: run.id,
        itemInstanceId: persistedDrop.id.toString(),
      });
    }
    const nextCombatAt = new Date(run.resolvedAt.getTime() + run.durationMs);

    return {
      kind: 'resolved',
      replayed: true,
      combat: resolved(run, attempt, character, nextCombatAt),
      serverTime: this.clock.now(),
    };
  }
}

function resolved(
  run: CombatRun,
  attempt: StageAttemptResult,
  character: Character,
  nextCombatAt: Date,
): ResolvedCombat {
  // Everything that describes the character after this combat comes from the
  // same snapshot: its progress from the attempt and its mode from the record.
  // On a replay the character may have switched mode since (ADR-021); mixing
  // the current mode with the recorded stage would describe a state that never
  // existed.
  const after: Character = {
    ...character,
    ...attempt.after,
    stageMode: run.stageMode,
    nextCombatAt,
  };

  return {
    run,
    attempt,
    before: snapshot(attempt.before, attempt.rulesVersion),
    after: snapshot(attempt.after, attempt.rulesVersion),
    character: after,
    progression: viewProgression(after),
  };
}

function snapshot(progress: CharacterProgress, rulesVersion: number): ProgressSnapshot {
  return {
    ...progress,
    experienceToNextLevel: experienceToNextLevel(
      progress.level,
      getGameRules(rulesVersion).progression,
    ),
  };
}
