import {
  IDEMPOTENCY_KEY_HEADER,
  offlineProgressResponseSchema,
  type OfflineProgressResponse,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { authorizedJson } from '@/lib/api-client';

/**
 * `POST /player/characters/:characterId/offline-progress` (ADR-023).
 *
 * Sends no gameplay input at all — no elapsed time, no device clock, no
 * "last seen". The server measures the absence on its own clock and decides
 * what it was worth. The idempotency key names one claim intent: sending it
 * again after a lost response returns the same claim, never a second one.
 * 201 is a new claim; 200 is a replay or "nothing to collect".
 */
export function claimOfflineProgress(
  tokens: AccessTokenSource,
  characterId: string,
  idempotencyKey: string,
): Promise<OfflineProgressResponse> {
  return authorizedJson(tokens, {
    path: `/player/characters/${encodeURIComponent(characterId)}/offline-progress`,
    method: 'POST',
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    schema: offlineProgressResponseSchema,
    acceptStatus: [200, 201],
  });
}
