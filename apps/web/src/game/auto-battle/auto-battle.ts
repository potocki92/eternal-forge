import type { CombatFailure, CombatSessionState } from '../combat-session';

/**
 * Online auto-battle: the player's standing intent "keep fighting while I
 * watch", and the rule for when that intent sends the next fight (ADR-022).
 *
 * It is presentation state, like the combat session it drives. It never
 * decides an outcome, a reward, a stage or how long anything takes: each fight
 * is the ordinary combat request (ADR-019), and the earliest moment for the
 * next one is the server's `nextCombatAt`. Local timers only choose *when to
 * ask*; a timer that fires early is answered `409` by the server, one that
 * fires late (a throttled background tab) simply asks later. Nothing is ever
 * made up for time that passed.
 *
 *   off ──start──▶ running ──stop (request in flight)──▶ stopping ──settled──▶ off
 *                    │  ▲                                                        ▲
 *                    │  └──────────── start ─────────────┐                      │
 *                    ├──stop (nothing in flight)─────────┼──────────────────────┘
 *                    └──fatal failure / too many─────▶ halted
 */
export type AutoBattleState =
  | { readonly status: 'off' }
  | {
      readonly status: 'running';
      /** Consecutive failed requests since the last fight that resolved. */
      readonly failures: number;
    }
  /** Stop was pressed while a request was in flight: that fight completes, no other starts. */
  | { readonly status: 'stopping' }
  | { readonly status: 'halted'; readonly halt: AutoBattleHalt };

export interface AutoBattleHalt {
  readonly reason: 'session' | 'unplayable' | 'missing' | 'rejected' | 'unreachable' | 'busy';
  /** Player-facing explanation. */
  readonly message: string;
}

export type AutoBattleAction =
  | { readonly type: 'start' }
  /** `inFlight`: a combat request has been sent and not yet answered. */
  | { readonly type: 'stop'; readonly inFlight: boolean }
  /** A combat request was answered with a combat (new or replayed). */
  | { readonly type: 'resolved' }
  | { readonly type: 'failed'; readonly failure: CombatFailure }
  | { readonly type: 'halt'; readonly halt: AutoBattleHalt };

export const AUTO_BATTLE_OFF: AutoBattleState = { status: 'off' };

/**
 * Consecutive failures after which the loop gives up and says so, instead of
 * asking forever. Each is already the end of a request the combat session
 * retried on its own (with the same idempotency key), so this is a long
 * outage, not a blip.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Backoff between retries of a failed request: 2 s, 4 s, 8 s, … capped. */
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 30_000;

/**
 * After the server says "still fighting" (another tab or device won the
 * gate, or a local clock ran ahead), the loop waits for the fresh state *and*
 * at least this long, so a disagreement can never become a request storm.
 */
export const BUSY_RETRY_MS = 1_000;

/** When the fresh state after a "still fighting" answer cannot be read. */
export const STALE_STATE_RETRY_MS = 15_000;

export function autoBattleReducer(
  state: AutoBattleState,
  action: AutoBattleAction,
): AutoBattleState {
  switch (action.type) {
    case 'start':
      return state.status === 'running' ? state : { status: 'running', failures: 0 };
    case 'stop':
      if (state.status === 'running' && action.inFlight) {
        return { status: 'stopping' };
      }
      // Also dismisses a halted loop.
      return state.status === 'off' ? state : AUTO_BATTLE_OFF;
    case 'resolved':
      if (state.status === 'stopping') {
        return AUTO_BATTLE_OFF;
      }
      return state.status === 'running' && state.failures > 0
        ? { status: 'running', failures: 0 }
        : state;
    case 'failed':
      if (state.status === 'stopping') {
        return AUTO_BATTLE_OFF;
      }
      if (state.status !== 'running') {
        return state;
      }
      return afterFailure(state.failures + 1, action.failure);
    case 'halt':
      return state.status === 'running' ? { status: 'halted', halt: action.halt } : state;
  }
}

function afterFailure(failures: number, failure: CombatFailure): AutoBattleState {
  switch (failure.kind) {
    case 'session':
    case 'unplayable':
    case 'missing':
    case 'rejected':
      // Asking again cannot change the answer.
      return { status: 'halted', halt: { reason: failure.kind, message: failure.message } };
    case 'busy':
      return failures >= MAX_CONSECUTIVE_FAILURES * 2
        ? {
            status: 'halted',
            halt: {
              reason: 'busy',
              message: 'Your hero keeps fighting somewhere else. Auto battle stopped here.',
            },
          }
        : { status: 'running', failures };
    case 'connection':
    case 'unavailable':
    case 'limited':
      return failures >= MAX_CONSECUTIVE_FAILURES
        ? {
            status: 'halted',
            halt: {
              reason: 'unreachable',
              message: 'The forge cannot be reached. Auto battle stopped; your progress is safe.',
            },
          }
        : { status: 'running', failures };
  }
}

/** What the loop sees of the screen when it decides whether to fight. */
export interface AutoBattleView {
  readonly session: CombatSessionState;
  /** The finished combat's result has been shown and the next enemy is in. */
  readonly resultShown: boolean;
  /** Local epoch ms at which the server's pacing gate opens (`localReadyAt`). */
  readonly readyAt: number;
  /** Local epoch ms the authoritative player state last arrived. */
  readonly stateReceivedAt: number;
  /** The server named an enemy for the current stage. */
  readonly hasEncounter: boolean;
  /** Another write the fight must not overlap is pending (a stage selection). */
  readonly otherWritePending: boolean;
  /** The page is visible. A hidden page starts no fight (ADR-022). */
  readonly visible: boolean;
}

export type AutoBattleStep =
  /** Nothing to do until something in the view changes. */
  | { readonly kind: 'wait'; readonly why: AutoBattleWait }
  /** Send the next fight at local epoch ms `at` (now, if it has passed). */
  | { readonly kind: 'fight'; readonly at: number; readonly retry: boolean }
  | { readonly kind: 'halt'; readonly halt: AutoBattleHalt };

export type AutoBattleWait = 'off' | 'fighting' | 'result' | 'hidden' | 'selection' | 'failed';

/**
 * The single decision the loop makes: given the intent and the screen, when
 * should the next fight be sent? A pure function of its inputs, so every
 * timing rule is testable without timers.
 */
export function nextAutoBattleStep(auto: AutoBattleState, view: AutoBattleView): AutoBattleStep {
  if (auto.status !== 'running') {
    return { kind: 'wait', why: 'off' };
  }
  const { session } = view;
  if (session.phase === 'requesting' || session.phase === 'fighting') {
    return { kind: 'wait', why: 'fighting' };
  }
  if (session.phase === 'finished' && !view.resultShown) {
    return { kind: 'wait', why: 'result' };
  }
  if (!view.visible) {
    return { kind: 'wait', why: 'hidden' };
  }
  if (view.otherWritePending) {
    return { kind: 'wait', why: 'selection' };
  }

  if (session.phase === 'failed') {
    const since = session.failedAt;
    if (session.failure.kind === 'busy') {
      // Decide from the server's fresh state, never from the stale one. If
      // that state cannot be read, ask again much later: the server decides.
      return view.stateReceivedAt >= since
        ? withEncounter(view, Math.max(view.readyAt, since + BUSY_RETRY_MS), false)
        : { kind: 'fight', at: since + STALE_STATE_RETRY_MS, retry: true };
    }
    if (session.failure.retryable) {
      // The same idempotency key is reused: a lost response is replayed.
      return { kind: 'fight', at: since + retryDelay(auto.failures), retry: true };
    }
    // A fatal failure: the reducer halts the loop when it sees it.
    return { kind: 'wait', why: 'failed' };
  }

  return withEncounter(view, view.readyAt, false);
}

function withEncounter(view: AutoBattleView, at: number, retry: boolean): AutoBattleStep {
  if (!view.hasEncounter) {
    return {
      kind: 'halt',
      halt: { reason: 'unplayable', message: 'No enemy can be found beyond this stage.' },
    };
  }
  return { kind: 'fight', at, retry };
}

/** 2 s, 4 s, 8 s, 16 s, 30 s … for the n-th consecutive failure (n ≥ 1). */
export function retryDelay(failures: number): number {
  const exponent = Math.max(0, failures - 1);
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(exponent, 10));
}
