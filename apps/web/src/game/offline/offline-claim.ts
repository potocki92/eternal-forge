import type { OfflineProgressDto } from '@eternal-forge/contracts';
import { ApiError } from '@/lib/api-client';

/**
 * The client side of an offline claim (ADR-023): presentation state only.
 * Every number in a summary comes from the server; this module decides only
 * what to show and whether a retry may reuse its key.
 *
 *   needed ──claim──▶ claiming ──answer──▶ shown (fights > 0) ──continue──▶ settled
 *                        │         └────▶ settled (nothing to collect)
 *                        └──error──▶ failed ──retry (same key)──▶ claiming
 *                                       └──play without it──▶ settled
 *
 * `needed` is the state on entering the game and after the page was hidden:
 * the client asks once whether the absence earned anything before it fights,
 * because an online fight ends the idle time for good.
 */
export type OfflineClaimState =
  | { readonly status: 'needed' }
  | { readonly status: 'claiming'; readonly key: string }
  | { readonly status: 'failed'; readonly key: string; readonly failure: OfflineClaimFailure }
  | { readonly status: 'shown'; readonly summary: OfflineProgressDto }
  | { readonly status: 'settled' };

export interface OfflineClaimFailure {
  readonly message: string;
  /** Retrying reuses the key, so a claim that did commit is replayed, not repeated. */
  readonly retryable: boolean;
}

export type OfflineClaimAction =
  | { readonly type: 'need' }
  | { readonly type: 'claim'; readonly key: string }
  | { readonly type: 'answer'; readonly summary: OfflineProgressDto }
  | { readonly type: 'fail'; readonly failure: OfflineClaimFailure }
  | { readonly type: 'dismiss' };

export const OFFLINE_CLAIM_NEEDED: OfflineClaimState = { status: 'needed' };

export function offlineClaimReducer(
  state: OfflineClaimState,
  action: OfflineClaimAction,
): OfflineClaimState {
  switch (action.type) {
    case 'need':
      // A summary on screen, a claim in flight or a failure waiting for the
      // player all already cover the return.
      return state.status === 'settled' ? { status: 'needed' } : state;
    case 'claim':
      return state.status === 'needed' || state.status === 'failed'
        ? { status: 'claiming', key: action.key }
        : state;
    case 'answer':
      if (state.status !== 'claiming') {
        return state;
      }
      return action.summary.fights > 0
        ? { status: 'shown', summary: action.summary }
        : { status: 'settled' };
    case 'fail':
      return state.status === 'claiming'
        ? { status: 'failed', key: state.key, failure: action.failure }
        : state;
    case 'dismiss':
      return state.status === 'shown' || state.status === 'failed' ? { status: 'settled' } : state;
  }
}

/** Whether fights must wait: a claim is still to be asked for or in flight. */
export function blocksFighting(state: OfflineClaimState): boolean {
  return state.status === 'needed' || state.status === 'claiming';
}

/** The key for the next claim: the failed claim's own key, or a fresh one. */
export function keyForNextClaim(state: OfflineClaimState, newKey: () => string): string {
  return state.status === 'failed' && state.failure.retryable ? state.key : newKey();
}

export function describeOfflineClaimFailure(error: unknown): OfflineClaimFailure {
  if (error instanceof ApiError && error.status !== undefined && error.status < 500) {
    if (error.status === 429 || error.code === 'CONCURRENT_UPDATE') {
      return {
        message: 'Your hero was busy. Try again in a moment — nothing is lost.',
        retryable: true,
      };
    }
    return { message: 'Your offline progress could not be collected.', retryable: false };
  }
  return {
    message:
      'Your offline progress could not be collected right now. It is safe — try again in a moment.',
    retryable: true,
  };
}

/**
 * A duration as a player reads it: "3h 42m", "12m", "45s". Presentation only;
 * the server decides every duration shown.
 */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m`;
  }
  return `${String(seconds)}s`;
}
