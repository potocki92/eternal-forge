import {
  GAME_RULES_VERSION,
  getGameRules,
  resolveOfflineProgress,
  resolveStage,
  type OfflineIdleReason,
  type Stage,
  type StageRewards,
} from '@eternal-forge/game-core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { CLOCK, type Clock } from '../../common/clock/clock.port.js';
import { progressOf, type Character } from '../../player/domain/player.js';
import { viewProgression, type ProgressionView } from '../../player/domain/progression-view.js';
import {
  capOf,
  elapsedOf,
  recordOfflineClaim,
  rewardedOf,
  type OfflineRun,
} from '../domain/offline-run.js';
import {
  OFFLINE_PROGRESS_REPOSITORY,
  type OfflineClaimTarget,
  type OfflineProgressRepository,
} from './ports/offline-progress-repository.port.js';
import { OFFLINE_SEED_SOURCE, type OfflineSeedSource } from './ports/offline-seed-source.port.js';

export interface ClaimOfflineProgressCommand {
  readonly characterId: string;
  /** One claim intent. Validated as a UUID at the transport boundary. */
  readonly idempotencyKey: string;
}

/** What a claim found and, when it fought, what it granted. */
export interface OfflineClaimSummary {
  /** The recorded claim, or `null` when nothing was collected. */
  readonly runId: string | null;
  readonly idleSince: Date;
  readonly claimedAt: Date;
  readonly elapsedMs: number;
  readonly rewardedMs: number;
  readonly capMs: number;
  readonly capReached: boolean;
  readonly processedUntil: Date;
  readonly target: Stage | null;
  readonly idleReason: OfflineIdleReason | null;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly rewards: StageRewards;
  readonly levelsGained: number;
}

export type ClaimOfflineProgressResult =
  | {
      /**
       * `collected`: a new claim was committed. `replayed`: the key already
       * had one and nothing was written. `nothing`: no fight fit, nothing was
       * written and the idle time keeps accumulating.
       */
      readonly kind: 'collected' | 'replayed' | 'nothing';
      readonly offline: OfflineClaimSummary;
      /** The character as it is now, after the claim. */
      readonly character: Character;
      readonly progression: ProgressionView;
      readonly serverTime: Date;
    }
  | { readonly kind: 'not-found' }
  /** The character kept changing under every attempt. Nothing is written. */
  | { readonly kind: 'conflict' };

/**
 * Attempts before giving up on a character that keeps changing. A claim only
 * loses to a combat, a selection or another claim; after a committed claim
 * or combat the next attempt finds nothing left to collect and is cheap.
 */
export const CLAIM_OFFLINE_MAX_ATTEMPTS = 3;

/**
 * Command: convert the caller's character's idle time into offline progress
 * (ADR-023).
 *
 * The client names only the character and an idempotency key. The idle time,
 * the farm stage, every fight and every reward are decided here, by the
 * server clock and Game Core, from persisted state:
 *
 * 1. Load the owned character, its version, its offline seed and any claim
 *    already recorded under this key — one owner-scoped read.
 * 2. A recorded claim is replayed from its stored summary: nothing is written
 *    and nothing is simulated again, so a repeated key costs one read.
 * 3. The idle time is the server clock minus the processed boundary
 *    (`nextCombatAt`), never negative. `resolveOfflineProgress` decides the
 *    rest under the current rules.
 * 4. No fight fitted: nothing is written; the idle time keeps accumulating.
 * 5. One conditional transaction writes the new level, experience, gold,
 *    processed boundary and next offline seed, and the claim record — only if
 *    the version is unchanged. The stage, the mode and the records are never
 *    written.
 * 6. On a conflict the whole claim is re-read and re-resolved, a bounded
 *    number of times: a concurrent retry of this request is then replayed, a
 *    concurrent winner leaves nothing to collect.
 *
 * Structured events: `offline.processed`, `offline.capped`,
 * `offline.replayed`, `offline.noop`, `offline.conflict` and
 * `offline.rejected`, with the character id, counts and durations — never a
 * token, a seed or a request body.
 */
@Injectable()
export class ClaimOfflineProgressUseCase {
  private readonly logger = new Logger(ClaimOfflineProgressUseCase.name);

  constructor(
    @Inject(OFFLINE_PROGRESS_REPOSITORY) private readonly offline: OfflineProgressRepository,
    @Inject(OFFLINE_SEED_SOURCE) private readonly seeds: OfflineSeedSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    command: ClaimOfflineProgressCommand,
  ): Promise<ClaimOfflineProgressResult> {
    for (let attempt = 1; attempt <= CLAIM_OFFLINE_MAX_ATTEMPTS; attempt += 1) {
      const target = await this.offline.loadClaimTarget(
        identity.authUserId,
        command.characterId,
        command.idempotencyKey,
      );
      if (target === null) {
        return { kind: 'not-found' };
      }
      if (target.existingRun !== null) {
        return this.replay(target.character, target.existingRun);
      }

      const outcome = await this.claim(identity, command, target);
      if (outcome !== 'conflict') {
        return outcome;
      }
      this.logger.log({
        msg: 'Offline claim lost a concurrent write',
        event: 'offline.conflict',
        characterId: command.characterId,
        attempt,
      });
    }

    this.logger.warn({
      msg: 'Offline claim gave up: the character kept changing',
      event: 'offline.rejected',
      characterId: command.characterId,
      reason: 'conflict',
    });
    return { kind: 'conflict' };
  }

  private async claim(
    identity: AuthenticatedIdentity,
    command: ClaimOfflineProgressCommand,
    { character, version, offlineSeed }: OfflineClaimTarget,
  ): Promise<ClaimOfflineProgressResult | 'conflict'> {
    const claimedAt = this.clock.now();
    const idleSince = character.nextCombatAt;
    // A hero still fighting (or a boundary ahead of this instance's clock) has
    // no idle time at all; it is never negative.
    const elapsedMs = Math.max(0, claimedAt.getTime() - idleSince.getTime());

    const startedAt = performance.now();
    const result = resolveOfflineProgress({
      progress: progressOf(character),
      elapsedMs,
      seed: offlineSeed,
      rulesVersion: GAME_RULES_VERSION,
    });
    const simulationMs = Math.round(performance.now() - startedAt);

    if (result.idleReason !== null) {
      this.logNothing(character, result.idleReason, elapsedMs);
      return {
        kind: 'nothing',
        offline: {
          runId: null,
          idleSince,
          claimedAt,
          elapsedMs,
          rewardedMs: result.rewardedMs,
          capMs: getGameRules(result.rulesVersion).offline.capMs,
          capReached: result.capReached,
          processedUntil: idleSince,
          target: result.target,
          idleReason: result.idleReason,
          fights: 0,
          wins: 0,
          losses: 0,
          rewards: result.rewards,
          levelsGained: 0,
        },
        character,
        progression: viewProgression(character),
        serverTime: claimedAt,
      };
    }

    const record = recordOfflineClaim(result, {
      characterId: character.id,
      idempotencyKey: command.idempotencyKey,
      idleSince,
      claimedAt,
    });
    const committed = await this.offline.commitClaim({
      authUserId: identity.authUserId,
      characterId: character.id,
      expectedVersion: version,
      level: result.after.level,
      experience: result.after.experience,
      gold: result.after.gold,
      processedUntil: record.processedUntil,
      nextOfflineSeed: this.seeds.next(),
      run: record,
    });
    if (committed.kind === 'conflict') {
      return 'conflict';
    }

    this.logger.log({
      msg: 'Offline progress collected',
      event: 'offline.processed',
      characterId: character.id,
      offlineRunId: committed.run.id,
      targetStage: record.targetStage.toString(),
      elapsedMs,
      rewardedMs: result.rewardedMs,
      capReached: result.capReached,
      fights: result.fights,
      wins: result.wins,
      losses: result.losses,
      levelsGained: result.levelsGained,
      simulationMs,
    });
    if (result.capReached) {
      this.logger.log({
        msg: 'Offline progress capped',
        event: 'offline.capped',
        characterId: character.id,
        offlineRunId: committed.run.id,
        elapsedMs,
        rewardedMs: result.rewardedMs,
      });
    }

    return {
      kind: 'collected',
      offline: summaryOf(committed.run),
      character: committed.character,
      progression: viewProgression(committed.character),
      serverTime: claimedAt,
    };
  }

  /**
   * The claim already recorded under the key, from its stored summary.
   * `character` is the character as it is now: the claim is long committed,
   * and the client should show the current authoritative state.
   */
  private replay(character: Character, run: OfflineRun): ClaimOfflineProgressResult {
    this.logger.log({
      msg: 'Offline claim replayed for a repeated idempotency key',
      event: 'offline.replayed',
      characterId: character.id,
      offlineRunId: run.id,
    });
    return {
      kind: 'replayed',
      offline: summaryOf(run),
      character,
      progression: viewProgression(character),
      serverTime: this.clock.now(),
    };
  }

  private logNothing(character: Character, reason: OfflineIdleReason, elapsedMs: number): void {
    if (reason === 'STAGE_NOT_PLAYABLE') {
      this.logger.warn({
        msg: 'Offline claim refused: the rule set cannot scale the farm stage',
        event: 'offline.rejected',
        characterId: character.id,
        reason,
        elapsedMs,
      });
      return;
    }
    // Debug: every return to the game asks once, and most find little.
    this.logger.debug({
      msg: 'Offline claim found nothing to collect',
      event: 'offline.noop',
      characterId: character.id,
      reason,
      elapsedMs,
    });
  }
}

function summaryOf(run: OfflineRun): OfflineClaimSummary {
  const elapsedMs = elapsedOf(run);
  const rewardedMs = rewardedOf(run);
  return {
    runId: run.id,
    idleSince: run.idleSince,
    claimedAt: run.claimedAt,
    elapsedMs,
    rewardedMs,
    capMs: capOf(run),
    capReached: rewardedMs < elapsedMs,
    processedUntil: run.processedUntil,
    // Classified by the rule set the claim ran under, never by the client.
    target: resolveStage(run.targetStage, getGameRules(run.rulesVersion).stages),
    idleReason: null,
    fights: run.fights,
    wins: run.wins,
    losses: run.losses,
    rewards: run.rewards,
    levelsGained: run.levelsGained,
  };
}
