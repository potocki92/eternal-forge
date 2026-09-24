'use client';

import type { CombatResponse, InventoryResponse } from '@eternal-forge/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useReducer, useRef } from 'react';
import { useAuth } from '@/auth/auth-provider';
import type { PlayerStateResult } from '@/player/player-api';
import { playerStateKey } from '@/player/use-player';
import { inventoryKey } from '@/gear/use-gear';
import { startCombat } from './combat-api';
import {
  INITIAL_SESSION,
  combatSessionReducer,
  describeCombatFailure,
  isTransientFailure,
  keyForNextFight,
  type CombatSessionState,
} from './combat-session';

export interface CombatSession {
  readonly state: CombatSessionState;
  /** Starts (or retries) a combat. Ignored while one is requested or playing. */
  readonly fight: () => void;
  /** The playback ended or was skipped. */
  readonly finish: () => void;
}

/**
 * Drives one character's combats against the API.
 *
 * - One idempotency key per intent, generated when the player asks to fight
 *   and reused for every retry of that intent — automatic retries of a lost
 *   connection, and a manual "try again" — so a lost response can never
 *   become a second combat.
 * - A synchronous guard on top of the state machine: two taps within one
 *   frame still send one request.
 * - The authoritative result replaces the cached player state, which is then
 *   refetched in the background once the combat has been shown.
 *
 * The caller mounts this per signed-in user (the game screen is keyed by user
 * id), and the auth provider clears the query cache on any change of user, so
 * no combat state outlives its account.
 */
export function useCombatSession(userId: string, characterId: string): CombatSession {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(combatSessionReducer, INITIAL_SESSION);
  const inFlight = useRef(false);
  const stateKey = playerStateKey(userId);

  const mutation = useMutation({
    mutationFn: (idempotencyKey: string) => startCombat(tokens, characterId, idempotencyKey),
    // Same variables, same key: an automatic retry can only replay.
    retry: (failureCount, error) => isTransientFailure(error) && failureCount < 2,
    retryDelay: (attempt) => Math.min(4_000, 500 * 2 ** attempt),
  });

  const applyResponse = useCallback(
    (response: CombatResponse) => {
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
      const dropped = response.combat.rewards.item;
      if (dropped !== null) {
        const key = inventoryKey(userId, characterId);
        queryClient.setQueryData<InventoryResponse>(key, (previous) =>
          previous === undefined
            ? previous
            : previous.ownedItems.some((item) => item.id === dropped.id)
              ? previous
              : { ownedItems: [...previous.ownedItems, dropped] },
        );
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [characterId, queryClient, stateKey, userId],
  );

  const fight = useCallback(() => {
    if (inFlight.current || state.phase === 'requesting' || state.phase === 'fighting') {
      return;
    }
    inFlight.current = true;
    const key = keyForNextFight(state, () => crypto.randomUUID());
    dispatch({ type: 'request', key });

    mutation.mutate(key, {
      onSuccess: (response) => {
        applyResponse(response);
        dispatch({ type: 'resolve', response, receivedAt: Date.now() });
      },
      onError: (error) => {
        const failure = describeCombatFailure(error);
        if (!failure.retryable) {
          // The server knows better: fetch its current state.
          void queryClient.invalidateQueries({ queryKey: stateKey });
        }
        dispatch({ type: 'fail', failure, at: Date.now() });
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }, [applyResponse, mutation, queryClient, state, stateKey]);

  const finish = useCallback(() => {
    dispatch({ type: 'finish' });
    void queryClient.invalidateQueries({ queryKey: stateKey });
  }, [queryClient, stateKey]);

  return { state, fight, finish };
}
