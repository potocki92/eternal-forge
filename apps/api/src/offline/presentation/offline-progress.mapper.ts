import type { OfflineProgressDto, OfflineProgressResponse } from '@eternal-forge/contracts';
import { toCharacterDto, toProgressionDto } from '../../player/presentation/player.mapper.js';
import type {
  ClaimOfflineProgressResult,
  OfflineClaimSummary,
} from '../application/claim-offline-progress.use-case.js';

type Answered = Extract<ClaimOfflineProgressResult, { readonly offline: OfflineClaimSummary }>;

/** Domain → shared contract. The seed and the owner never leave the API. */
export function toOfflineProgressResponse(result: Answered): OfflineProgressResponse {
  return {
    offline: toOfflineProgressDto(result.offline),
    character: toCharacterDto(result.character),
    progression: toProgressionDto(result.progression),
    serverTime: result.serverTime.toISOString(),
  };
}

function toOfflineProgressDto(summary: OfflineClaimSummary): OfflineProgressDto {
  return {
    id: summary.runId,
    idleSince: summary.idleSince.toISOString(),
    claimedAt: summary.claimedAt.toISOString(),
    elapsedMs: summary.elapsedMs,
    rewardedMs: summary.rewardedMs,
    capMs: summary.capMs,
    capReached: summary.capReached,
    processedUntil: summary.processedUntil.toISOString(),
    targetStage:
      summary.target === null
        ? null
        : { number: summary.target.number.toString(), kind: summary.target.kind },
    idleReason: summary.idleReason,
    fights: summary.fights,
    wins: summary.wins,
    losses: summary.losses,
    rewards: {
      gold: summary.rewards.gold.toString(),
      experience: summary.rewards.experience.toString(),
    },
    levelsGained: summary.levelsGained,
  };
}
