import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { combatResponseFixture } from '@/test/fixtures';
import { describeCombatFailure, type CombatSessionState } from '../combat-session';
import {
  AUTO_BATTLE_OFF,
  BUSY_RETRY_MS,
  MAX_CONSECUTIVE_FAILURES,
  RETRY_MAX_MS,
  STALE_STATE_RETRY_MS,
  autoBattleReducer as reduce,
  nextAutoBattleStep,
  retryDelay,
  type AutoBattleState,
  type AutoBattleView,
} from './auto-battle';

const response = combatResponseFixture();
const connectionLost = describeCombatFailure(new ApiError('offline'));
const busy = describeCombatFailure(new ApiError('busy', 409, { code: 'COMBAT_NOT_READY' }));
const sessionEnded = describeCombatFailure(new ApiError('gone', 401, { code: 'UNAUTHENTICATED' }));
const unplayable = describeCombatFailure(new ApiError('deep', 409, { code: 'STAGE_NOT_PLAYABLE' }));
const running: AutoBattleState = { status: 'running', failures: 0 };

function view(overrides: Partial<AutoBattleView> = {}): AutoBattleView {
  return {
    session: { phase: 'idle' },
    resultShown: false,
    readyAt: 10_000,
    stateReceivedAt: 0,
    hasEncounter: true,
    otherWritePending: false,
    visible: true,
    ...overrides,
  };
}

function failed(failure = connectionLost, failedAt = 50_000): CombatSessionState {
  return { phase: 'failed', key: 'k1', failure, failedAt };
}

describe('autoBattleReducer', () => {
  it('starts, and a second start changes nothing', () => {
    const started = reduce(AUTO_BATTLE_OFF, { type: 'start' });
    expect(started).toEqual(running);
    expect(reduce(started, { type: 'start' })).toBe(started);
  });

  it('stops at once when nothing is in flight', () => {
    expect(reduce(running, { type: 'stop', inFlight: false })).toEqual(AUTO_BATTLE_OFF);
  });

  it('lets a fight in flight finish, then stops — whatever its answer', () => {
    const stopping = reduce(running, { type: 'stop', inFlight: true });
    expect(stopping).toEqual({ status: 'stopping' });
    expect(reduce(stopping, { type: 'resolved' })).toEqual(AUTO_BATTLE_OFF);
    expect(reduce(stopping, { type: 'failed', failure: connectionLost })).toEqual(AUTO_BATTLE_OFF);
  });

  it('can be started again while stopping, and restarted after a halt', () => {
    expect(reduce({ status: 'stopping' }, { type: 'start' })).toEqual(running);
    const halted = reduce(running, { type: 'failed', failure: sessionEnded });
    expect(reduce(halted, { type: 'start' })).toEqual(running);
    expect(reduce(halted, { type: 'stop', inFlight: false })).toEqual(AUTO_BATTLE_OFF);
  });

  it.each([
    ['session', sessionEnded],
    ['unplayable', unplayable],
    ['missing', describeCombatFailure(new ApiError('missing', 404, { code: 'NOT_FOUND' }))],
    ['rejected', describeCombatFailure(new ApiError('forbidden', 403, { code: 'HTTP_ERROR' }))],
  ] as const)('halts on a %s failure: asking again cannot help', (reason, failure) => {
    expect(reduce(running, { type: 'failed', failure })).toEqual({
      status: 'halted',
      halt: { reason, message: failure.message },
    });
  });

  it('counts consecutive transient failures, resets on a resolved fight, gives up at the bound', () => {
    let state: AutoBattleState = running;
    for (let failure = 1; failure < MAX_CONSECUTIVE_FAILURES; failure += 1) {
      state = reduce(state, { type: 'failed', failure: connectionLost });
      expect(state).toEqual({ status: 'running', failures: failure });
    }
    expect(reduce(state, { type: 'resolved' })).toEqual(running);

    const gaveUp = reduce(state, { type: 'failed', failure: connectionLost });
    expect(gaveUp).toMatchObject({ status: 'halted', halt: { reason: 'unreachable' } });
  });

  it('tolerates "still fighting" answers longer, but not forever', () => {
    let state: AutoBattleState = running;
    for (let failure = 1; failure < MAX_CONSECUTIVE_FAILURES * 2; failure += 1) {
      state = reduce(state, { type: 'failed', failure: busy });
      expect(state.status).toBe('running');
    }
    expect(reduce(state, { type: 'failed', failure: busy })).toMatchObject({
      status: 'halted',
      halt: { reason: 'busy' },
    });
  });

  it('ignores answers while off: a manual fight never changes the loop', () => {
    expect(reduce(AUTO_BATTLE_OFF, { type: 'failed', failure: sessionEnded })).toBe(
      AUTO_BATTLE_OFF,
    );
    expect(reduce(AUTO_BATTLE_OFF, { type: 'resolved' })).toBe(AUTO_BATTLE_OFF);
  });
});

describe('nextAutoBattleStep — when the next fight is sent', () => {
  it('does nothing while off', () => {
    expect(nextAutoBattleStep(AUTO_BATTLE_OFF, view())).toEqual({ kind: 'wait', why: 'off' });
    expect(nextAutoBattleStep({ status: 'stopping' }, view())).toEqual({
      kind: 'wait',
      why: 'off',
    });
  });

  it('fights at the server’s gate, never before it', () => {
    expect(nextAutoBattleStep(running, view({ readyAt: 12_345 }))).toEqual({
      kind: 'fight',
      at: 12_345,
      retry: false,
    });
  });

  it('never overlaps: nothing is sent while a fight is requested or playing', () => {
    const requesting: CombatSessionState = { phase: 'requesting', key: 'k' };
    const fighting: CombatSessionState = { phase: 'fighting', response, receivedAt: 0 };
    expect(nextAutoBattleStep(running, view({ session: requesting }))).toMatchObject({
      kind: 'wait',
      why: 'fighting',
    });
    expect(nextAutoBattleStep(running, view({ session: fighting }))).toMatchObject({
      kind: 'wait',
      why: 'fighting',
    });
  });

  it('waits until the result has been shown, then fights at the gate', () => {
    const finished: CombatSessionState = { phase: 'finished', response, receivedAt: 0 };
    expect(nextAutoBattleStep(running, view({ session: finished }))).toMatchObject({
      kind: 'wait',
      why: 'result',
    });
    expect(
      nextAutoBattleStep(running, view({ session: finished, resultShown: true, readyAt: 4_000 })),
    ).toEqual({ kind: 'fight', at: 4_000, retry: false });
  });

  it('pauses while the page is hidden, and does not catch up afterwards', () => {
    expect(nextAutoBattleStep(running, view({ visible: false }))).toEqual({
      kind: 'wait',
      why: 'hidden',
    });
    // Visible again long after the gate: one fight, now — not one per missed gate.
    expect(nextAutoBattleStep(running, view({ readyAt: 1 }))).toEqual({
      kind: 'fight',
      at: 1,
      retry: false,
    });
  });

  it('waits for a pending stage choice, so the next fight uses it', () => {
    expect(nextAutoBattleStep(running, view({ otherWritePending: true }))).toEqual({
      kind: 'wait',
      why: 'selection',
    });
  });

  it('retries a transient failure with backoff', () => {
    const afterTwo: AutoBattleState = { status: 'running', failures: 2 };
    expect(nextAutoBattleStep(afterTwo, view({ session: failed() }))).toEqual({
      kind: 'fight',
      at: 50_000 + retryDelay(2),
      retry: true,
    });
  });

  it('after "still fighting", waits for the fresh state before deciding', () => {
    const stale = view({ session: failed(busy), stateReceivedAt: 49_999, readyAt: 49_500 });
    expect(nextAutoBattleStep(running, stale)).toEqual({
      kind: 'fight',
      at: 50_000 + STALE_STATE_RETRY_MS,
      retry: true,
    });

    // Fresh state, gate already open: still at least a second after the refusal.
    const fresh = view({ session: failed(busy), stateReceivedAt: 50_100, readyAt: 49_500 });
    expect(nextAutoBattleStep(running, fresh)).toEqual({
      kind: 'fight',
      at: 50_000 + BUSY_RETRY_MS,
      retry: false,
    });

    // Fresh state naming a later gate (another tab fought): wait for that.
    const later = view({ session: failed(busy), stateReceivedAt: 50_100, readyAt: 58_000 });
    expect(nextAutoBattleStep(running, later)).toMatchObject({ kind: 'fight', at: 58_000 });
  });

  it('waits on a fatal failure: the reducer halts the loop', () => {
    expect(nextAutoBattleStep(running, view({ session: failed(sessionEnded) }))).toEqual({
      kind: 'wait',
      why: 'failed',
    });
  });

  it('halts instead of asking for a stage the server has no enemy for', () => {
    expect(nextAutoBattleStep(running, view({ hasEncounter: false }))).toMatchObject({
      kind: 'halt',
      halt: { reason: 'unplayable' },
    });
  });
});

describe('retryDelay', () => {
  it('doubles from two seconds and is capped', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(retryDelay)).toEqual([
      2_000,
      4_000,
      8_000,
      16_000,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
    ]);
    expect(retryDelay(0)).toBe(2_000);
  });
});
