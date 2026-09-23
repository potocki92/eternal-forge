'use client';

import type { ProvisionPlayerRequest } from '@eternal-forge/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { fetchPlayerState, provisionPlayer, type PlayerStateResult } from './player-api';

/**
 * Query keys are scoped by user id, so one account's cached state can never be
 * served under another's session even before the cache is cleared.
 */
export function playerStateKey(userId: string) {
  return ['player', userId, 'state'] as const;
}

/** Client errors are answers, not glitches: retrying them only delays the message. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : undefined;
  return (status === undefined || status >= 500) && failureCount < 2;
}

export function usePlayerState() {
  const { state, tokens } = useAuth();
  const userId = state.status === 'authenticated' ? state.userId : undefined;

  return useQuery({
    queryKey: playerStateKey(userId ?? 'anonymous'),
    queryFn: ({ signal }) => fetchPlayerState(tokens, { signal }),
    enabled: userId !== undefined,
    retry: shouldRetry,
  });
}

export function useProvisionPlayer() {
  const { state, tokens } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ProvisionPlayerRequest) => provisionPlayer(tokens, request),
    onSuccess: (playerState) => {
      if (state.status === 'authenticated') {
        const result: PlayerStateResult = { kind: 'provisioned', state: playerState };
        queryClient.setQueryData(playerStateKey(state.userId), result);
      }
    },
  });
}
