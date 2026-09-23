'use client';

import type { StageSelectionRequest, StageSelectionResponse } from '@eternal-forge/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import type { PlayerStateResult } from '@/player/player-api';
import { playerStateKey } from '@/player/use-player';
import { isTransientFailure } from '../combat-session';
import { describeSelectionFailure } from './stage-draft';
import { selectStage } from './stage-selection-api';

export interface StageSelection {
  /** Sends the choice. `onSaved` runs once the server's state is in the cache. */
  readonly select: (request: StageSelectionRequest, onSaved?: () => void) => void;
  readonly pending: boolean;
  /** Why the last choice was not saved, in player language. */
  readonly error: string | undefined;
  readonly clearError: () => void;
}

/**
 * Sends the player's stage choice (ADR-021) and shows only what the server
 * answers.
 *
 * - No optimistic update: the cache changes when the authoritative state
 *   arrives, so a locked stage is never shown, not even for a frame.
 * - A lost connection is retried with the same request, which is safe: the
 *   request sets a value, so repeating it cannot do anything twice.
 * - A refusal the server explains (locked, busy, missing) re-reads the player
 *   state, since the screen may be showing something stale.
 */
export function useStageSelection(userId: string, characterId: string): StageSelection {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  const stateKey = playerStateKey(userId);

  const mutation = useMutation({
    mutationFn: (request: StageSelectionRequest) => selectStage(tokens, characterId, request),
    retry: (failureCount, error) => isTransientFailure(error) && failureCount < 2,
    retryDelay: (attempt) => Math.min(4_000, 500 * 2 ** attempt),
  });
  const { mutate, reset } = mutation;

  const apply = useCallback(
    (response: StageSelectionResponse) => {
      queryClient.setQueryData<PlayerStateResult>(stateKey, (previous) =>
        previous?.kind === 'provisioned'
          ? {
              kind: 'provisioned',
              state: {
                ...previous.state,
                character: response.character,
                progression: response.progression,
                serverTime: response.serverTime,
              },
            }
          : previous,
      );
    },
    [queryClient, stateKey],
  );

  const select = useCallback(
    (request: StageSelectionRequest, onSaved?: () => void) => {
      mutate(request, {
        onSuccess: (response) => {
          // A player-state read that started before this write may still be
          // in flight; resolving later, it would put the old stage back.
          void queryClient.cancelQueries({ queryKey: stateKey });
          apply(response);
          onSaved?.();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status !== undefined && error.status < 500) {
            void queryClient.invalidateQueries({ queryKey: stateKey });
          }
        },
      });
    },
    [apply, mutate, queryClient, stateKey],
  );

  return {
    select,
    pending: mutation.isPending,
    error: mutation.isError ? describeSelectionFailure(mutation.error) : undefined,
    // Only a settled result is cleared: resetting a pending mutation would
    // report it as idle while its request can still commit.
    clearError: () => {
      if (!mutation.isPending) {
        reset();
      }
    },
  };
}
