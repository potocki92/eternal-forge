import {
  playerStateResponseSchema,
  type PlayerStateResponse,
  type ProvisionPlayerRequest,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { ApiError, authorizedJson } from '@/lib/api-client';

export type PlayerStateResult =
  | { readonly kind: 'provisioned'; readonly state: PlayerStateResponse }
  | { readonly kind: 'not-provisioned' };

/** `GET /player/state`. A new account without a player is a state, not an error. */
export async function fetchPlayerState(
  tokens: AccessTokenSource,
  options: { readonly signal?: AbortSignal } = {},
): Promise<PlayerStateResult> {
  try {
    const state = await authorizedJson(tokens, {
      path: '/player/state',
      schema: playerStateResponseSchema,
      ...options,
    });
    return { kind: 'provisioned', state };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PLAYER_NOT_PROVISIONED') {
      return { kind: 'not-provisioned' };
    }
    throw error;
  }
}

/** `POST /player`. Idempotent: safe to retry after a timeout or a double submit. */
export function provisionPlayer(
  tokens: AccessTokenSource,
  request: ProvisionPlayerRequest,
): Promise<PlayerStateResponse> {
  return authorizedJson(tokens, {
    path: '/player',
    method: 'POST',
    body: request,
    schema: playerStateResponseSchema,
    acceptStatus: [200, 201],
  });
}
