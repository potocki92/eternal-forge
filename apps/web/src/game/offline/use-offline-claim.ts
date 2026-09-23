'use client';

import type { OfflineProgressResponse } from '@eternal-forge/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/auth/auth-provider';
import type { PlayerStateResult } from '@/player/player-api';
import { playerStateKey } from '@/player/use-player';
import { isTransientFailure } from '../combat-session';
import { usePageVisible } from '../use-page-visible';
import { claimOfflineProgress } from './offline-api';
import {
  OFFLINE_CLAIM_NEEDED,
  describeOfflineClaimFailure,
  keyForNextClaim,
  offlineClaimReducer,
  type OfflineClaimState,
} from './offline-claim';

export interface OfflineClaim {
  readonly state: OfflineClaimState;
  /** Retries a failed claim with the same key. */
  readonly retry: () => void;
  /** Closes the summary, or gives up on a failed claim for now. */
  readonly dismiss: () => void;
}

/**
 * Collects offline progress when the player returns (ADR-023).
 *
 * On entering the game, and whenever the page becomes visible after being
 * hidden, the client asks the server once what the absence earned — before
 * any fight, because an online fight ends the idle time. The request carries
 * no time at all; the answer is authoritative and replaces the cached player
 * state. A lost connection is retried with the same key, so a claim that did
 * commit is answered by its replay.
 */
export function useOfflineClaim(
  userId: string,
  characterId: string,
  active: boolean,
): OfflineClaim {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  const stateKey = playerStateKey(userId);
  const [state, dispatch] = useReducer(offlineClaimReducer, OFFLINE_CLAIM_NEEDED);
  const visible = usePageVisible();
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: (idempotencyKey: string) =>
      claimOfflineProgress(tokens, characterId, idempotencyKey),
    retry: (failureCount, error) => isTransientFailure(error) && failureCount < 2,
    retryDelay: (attempt) => Math.min(4_000, 500 * 2 ** attempt),
  });
  const { mutate } = mutation;

  const apply = useCallback(
    (response: OfflineProgressResponse) => {
      // A player-state read started before the claim must not put the old
      // gold back when it resolves.
      void queryClient.cancelQueries({ queryKey: stateKey });
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

  const send = useCallback(
    (key: string) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      dispatch({ type: 'claim', key });
      mutate(key, {
        onSuccess: (response) => {
          apply(response);
          dispatch({ type: 'answer', summary: response.offline });
        },
        onError: (error) => {
          dispatch({ type: 'fail', failure: describeOfflineClaimFailure(error) });
        },
        onSettled: () => {
          inFlight.current = false;
        },
      });
    },
    [apply, mutate],
  );

  // A hidden page is an absence: ask again when the player is back.
  useEffect(() => {
    if (!visible) {
      dispatch({ type: 'need' });
    }
  }, [visible]);

  useEffect(() => {
    if (state.status === 'needed' && visible && active) {
      send(crypto.randomUUID());
    }
  }, [active, send, state.status, visible]);

  const retry = useCallback(() => {
    send(keyForNextClaim(state, () => crypto.randomUUID()));
  }, [send, state]);
  const dismiss = useCallback(() => {
    dispatch({ type: 'dismiss' });
  }, []);

  return { state, retry, dismiss };
}
