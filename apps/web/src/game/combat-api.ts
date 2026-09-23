import {
  IDEMPOTENCY_KEY_HEADER,
  combatResponseSchema,
  type CombatResponse,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { authorizedJson } from '@/lib/api-client';

/**
 * `POST /player/characters/:characterId/combats` (ADR-019).
 *
 * Sends no gameplay input at all: the server decides the stage, enemy, seed,
 * outcome and rewards. The idempotency key names one player intent. Sending it
 * again — after a timeout, a lost response or a double tap — returns the same
 * combat instead of fighting twice. 201 is a new combat, 200 a replay; both
 * carry the same body.
 */
export function startCombat(
  tokens: AccessTokenSource,
  characterId: string,
  idempotencyKey: string,
): Promise<CombatResponse> {
  return authorizedJson(tokens, {
    path: `/player/characters/${encodeURIComponent(characterId)}/combats`,
    method: 'POST',
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    schema: combatResponseSchema,
    acceptStatus: [200, 201],
  });
}
