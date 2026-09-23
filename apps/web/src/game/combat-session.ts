import type { CombatResponse } from '@eternal-forge/contracts';
import { ApiError } from '@/lib/api-client';

/**
 * The game screen's presentation state machine, independent of React.
 *
 *   idle ──fight──▶ requesting ──response──▶ fighting ──end/skip──▶ finished
 *                        │                                           │
 *                        └──error──▶ failed ◀────────────────────────┘ (next fight)
 *
 * It holds presentation state only. Everything gameplay — the combat, the
 * rewards, the next stage — arrives in the server's response and is shown,
 * never computed.
 */
export type CombatSessionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting'; readonly key: string }
  | {
      readonly phase: 'failed';
      readonly key: string;
      readonly failure: CombatFailure;
      /** Local epoch ms the failure was reported: anchors a retry's backoff. */
      readonly failedAt: number;
    }
  | {
      readonly phase: 'fighting' | 'finished';
      readonly response: CombatResponse;
      /** Local epoch ms the response arrived: anchors the server's times. */
      readonly receivedAt: number;
    };

export type CombatSessionAction =
  | { readonly type: 'request'; readonly key: string }
  | { readonly type: 'resolve'; readonly response: CombatResponse; readonly receivedAt: number }
  | { readonly type: 'fail'; readonly failure: CombatFailure; readonly at: number }
  | { readonly type: 'finish' };

export interface CombatFailure {
  readonly kind:
    | 'connection'
    | 'unavailable'
    | 'limited'
    | 'busy'
    | 'unplayable'
    | 'missing'
    | 'rejected'
    | 'session';
  readonly message: string;
  /**
   * Retrying reuses the same idempotency key: a lost response is answered by
   * the combat the server already resolved, never by a second one.
   */
  readonly retryable: boolean;
}

export const INITIAL_SESSION: CombatSessionState = { phase: 'idle' };

export function combatSessionReducer(
  state: CombatSessionState,
  action: CombatSessionAction,
): CombatSessionState {
  switch (action.type) {
    case 'request':
      // Duplicate protection: one combat at a time, whatever the UI does.
      return state.phase === 'requesting' || state.phase === 'fighting'
        ? state
        : { phase: 'requesting', key: action.key };
    case 'resolve':
      return state.phase === 'requesting'
        ? { phase: 'fighting', response: action.response, receivedAt: action.receivedAt }
        : state;
    case 'fail':
      return state.phase === 'requesting'
        ? { phase: 'failed', key: state.key, failure: action.failure, failedAt: action.at }
        : state;
    case 'finish':
      return state.phase === 'fighting' ? { ...state, phase: 'finished' } : state;
  }
}

/**
 * The key for the next request: the failed request's own key when it may be
 * retried — so the server can answer with the combat it may already have
 * resolved — and a fresh one for a new intent.
 */
export function keyForNextFight(state: CombatSessionState, newKey: () => string): string {
  return state.phase === 'failed' && state.failure.retryable ? state.key : newKey();
}

/** A player-facing reading of a failed combat request. */
export function describeCombatFailure(error: unknown): CombatFailure {
  if (!(error instanceof ApiError)) {
    return { kind: 'unavailable', message: 'Something went wrong. Try again.', retryable: true };
  }
  if (error.status === undefined) {
    return {
      kind: 'connection',
      message: 'Connection lost. Your fight is safe — try again to see how it went.',
      retryable: true,
    };
  }
  if (error.code === 'COMBAT_NOT_READY') {
    return { kind: 'busy', message: 'Your hero is still fighting.', retryable: false };
  }
  if (error.code === 'STAGE_NOT_PLAYABLE') {
    return {
      kind: 'unplayable',
      message: 'No enemy is known this deep yet. Your progress is safe.',
      retryable: false,
    };
  }
  if (error.status === 401) {
    return { kind: 'session', message: 'Your session has ended.', retryable: false };
  }
  if (error.status === 404) {
    return { kind: 'missing', message: 'Your hero could not be found.', retryable: false };
  }
  if (error.status === 429) {
    // Not a verdict on the fight: the same key may be sent again, later.
    return {
      kind: 'limited',
      message: 'Too many requests. Your fight is safe — try again in a moment.',
      retryable: true,
    };
  }
  if (error.status >= 400 && error.status < 500 && error.status !== 408) {
    // Forbidden, invalid or otherwise refused: repeating it cannot help.
    return { kind: 'rejected', message: 'The forge refused this fight.', retryable: false };
  }
  return {
    kind: 'unavailable',
    message: 'The forge is unreachable right now. Try again in a moment.',
    retryable: true,
  };
}

/** Transient failures a mutation may retry on its own, with the same key. */
export function isTransientFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status === undefined || error.status >= 502);
}

/**
 * When the next combat may start, in local epoch ms. The server's
 * `nextCombatAt` is read relative to its own `serverTime` and anchored to the
 * moment the answer arrived, so a wrong device clock never matters.
 */
export function localReadyAt(nextCombatAt: string, serverTime: string, receivedAt: number): number {
  return receivedAt + (Date.parse(nextCombatAt) - Date.parse(serverTime));
}
