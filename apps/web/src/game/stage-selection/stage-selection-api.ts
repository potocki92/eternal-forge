import {
  stageSelectionResponseSchema,
  type StageSelectionRequest,
  type StageSelectionResponse,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { authorizedJson } from '@/lib/api-client';

/**
 * `PUT /player/characters/:characterId/stage-selection` (ADR-021).
 *
 * Sends the player's intent only — climb, or farm stage N. The server decides
 * whether the stage is unlocked and answers with the authoritative state.
 * Repeating the request leaves the same state, so a retry is always safe.
 */
export function selectStage(
  tokens: AccessTokenSource,
  characterId: string,
  request: StageSelectionRequest,
): Promise<StageSelectionResponse> {
  return authorizedJson(tokens, {
    path: `/player/characters/${encodeURIComponent(characterId)}/stage-selection`,
    method: 'PUT',
    body: request,
    schema: stageSelectionResponseSchema,
  });
}
