import { z } from 'zod';
import { rewardsSchema } from '../combat/combat.contract.js';
import { characterSchema } from '../player/player.contract.js';
import { progressionSchema, stageSchema } from './progression.contract.js';

/**
 * `POST /player/characters/:characterId/offline-progress` — collect what the
 * hero earned while the player was away (ADR-023).
 *
 * Like a combat, the request has no body and carries no gameplay value: no
 * elapsed time, no "last seen", no client clock, no stage and no reward. The
 * server measures the idle time on its own clock, decides what it was worth
 * with Game Core and answers with the authoritative result. The client sends
 * the character it targets (path) and an `Idempotency-Key` header naming one
 * claim intent, reused for every retry of it.
 *
 * `201` reports a new claim; `200` reports either the replay of a claim
 * already collected under the key or a claim with nothing to collect
 * (`idleReason` says why). Nothing is written in that last case.
 */

/** Why a claim collected nothing. `null` when it collected fights. */
export const offlineIdleReasonSchema = z.enum([
  /** Less idle time than the rule set's minimum absence; it keeps accumulating. */
  'TOO_SOON',
  /** No stage has been cleared yet, so there is no safe stage to farm. */
  'NO_CLEARED_STAGE',
  /** The farm stage lies beyond what the rule set can scale into an enemy. */
  'STAGE_NOT_PLAYABLE',
]);
export type OfflineIdleReasonDto = z.infer<typeof offlineIdleReasonSchema>;

const count = z.number().int().min(0);
const milliseconds = z.number().int().min(0);

export const offlineProgressSchema = z
  .object({
    /** The recorded claim, or `null` when nothing was collected. */
    id: z.uuid().nullable(),
    /** Server time the idle period began: the hero's last accounted-for instant. */
    idleSince: z.iso.datetime(),
    /** Server time of the claim. */
    claimedAt: z.iso.datetime(),
    /** Idle time the server measured: `claimedAt − idleSince`, never negative. */
    elapsedMs: milliseconds,
    /** The part of it that counted: at most `capMs`. */
    rewardedMs: milliseconds,
    /** The rule set's cap on one claim. */
    capMs: z.number().int().min(1),
    /** True when the absence was longer than the cap. */
    capReached: z.boolean(),
    /**
     * Server time up to which the hero's time is now accounted for. The next
     * claim counts from here; the next combat may start from here.
     */
    processedUntil: z.iso.datetime(),
    /** The stage farmed — always one already cleared — or `null`. */
    targetStage: stageSchema.nullable(),
    idleReason: offlineIdleReasonSchema.nullable(),
    fights: count,
    wins: count,
    losses: count,
    /** Totals of every fight won. Zero when nothing was won. */
    rewards: rewardsSchema,
    levelsGained: count,
  })
  .refine((value) => value.wins + value.losses === value.fights, {
    message: 'wins and losses must add up to fights',
  })
  .refine((value) => (value.idleReason === null) === value.fights > 0, {
    message: 'idleReason must be set exactly when no fight was collected',
  })
  .refine((value) => value.rewardedMs <= value.elapsedMs && value.rewardedMs <= value.capMs, {
    message: 'rewardedMs cannot exceed elapsedMs or capMs',
  });
export type OfflineProgressDto = z.infer<typeof offlineProgressSchema>;

export const offlineProgressResponseSchema = z.object({
  offline: offlineProgressSchema,
  /** The character as the claim left it. */
  character: characterSchema,
  /** Derived values after the claim; the stage and mode are unchanged by it. */
  progression: progressionSchema,
  serverTime: z.iso.datetime(),
});
export type OfflineProgressResponse = z.infer<typeof offlineProgressResponseSchema>;
