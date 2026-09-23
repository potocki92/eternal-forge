import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { combatResponseFixture } from '@/test/fixtures';
import {
  INITIAL_SESSION,
  combatSessionReducer as reduce,
  describeCombatFailure,
  isTransientFailure,
  keyForNextFight,
  localReadyAt,
  type CombatSessionState,
} from './combat-session';

const response = combatResponseFixture();
const connectionLost = describeCombatFailure(new ApiError('offline'));

describe('combatSessionReducer', () => {
  it('runs a combat through request → fighting → finished', () => {
    const requesting = reduce(INITIAL_SESSION, { type: 'request', key: 'k1' });
    const fighting = reduce(requesting, { type: 'resolve', response, receivedAt: 5 });
    const finished = reduce(fighting, { type: 'finish' });

    expect(requesting).toEqual({ phase: 'requesting', key: 'k1' });
    expect(fighting).toEqual({ phase: 'fighting', response, receivedAt: 5 });
    expect(finished).toEqual({ phase: 'finished', response, receivedAt: 5 });
  });

  it('ignores a second fight while one is requested or playing', () => {
    const requesting: CombatSessionState = { phase: 'requesting', key: 'k1' };
    const fighting: CombatSessionState = { phase: 'fighting', response, receivedAt: 0 };

    expect(reduce(requesting, { type: 'request', key: 'k2' })).toBe(requesting);
    expect(reduce(fighting, { type: 'request', key: 'k2' })).toBe(fighting);
  });

  it('keeps the key of a failed request', () => {
    const failed = reduce(
      { phase: 'requesting', key: 'k1' },
      { type: 'fail', failure: connectionLost, at: 7 },
    );

    expect(failed).toEqual({ phase: 'failed', key: 'k1', failure: connectionLost, failedAt: 7 });
  });

  it('ignores responses that arrive for no pending request', () => {
    expect(reduce(INITIAL_SESSION, { type: 'resolve', response, receivedAt: 0 })).toBe(
      INITIAL_SESSION,
    );
    expect(reduce(INITIAL_SESSION, { type: 'finish' })).toBe(INITIAL_SESSION);
  });
});

describe('keyForNextFight', () => {
  const fresh = () => 'fresh';

  it('retries a retryable failure with the same key, so no second combat is fought', () => {
    expect(
      keyForNextFight({ phase: 'failed', key: 'k1', failure: connectionLost, failedAt: 0 }, fresh),
    ).toBe('k1');
  });

  it('uses a new key for a new intent', () => {
    const busy = describeCombatFailure(new ApiError('busy', 409, { code: 'COMBAT_NOT_READY' }));
    expect(keyForNextFight(INITIAL_SESSION, fresh)).toBe('fresh');
    expect(keyForNextFight({ phase: 'finished', response, receivedAt: 0 }, fresh)).toBe('fresh');
    expect(keyForNextFight({ phase: 'failed', key: 'k1', failure: busy, failedAt: 0 }, fresh)).toBe(
      'fresh',
    );
  });
});

describe('describeCombatFailure', () => {
  it.each([
    [new ApiError('offline'), 'connection', true],
    [new ApiError('busy', 409, { code: 'COMBAT_NOT_READY' }), 'busy', false],
    [new ApiError('deep', 409, { code: 'STAGE_NOT_PLAYABLE' }), 'unplayable', false],
    [new ApiError('gone', 401, { code: 'UNAUTHENTICATED' }), 'session', false],
    [new ApiError('missing', 404, { code: 'NOT_FOUND' }), 'missing', false],
    [new ApiError('down', 503), 'unavailable', true],
    [new ApiError('timeout', 408), 'unavailable', true],
    [new ApiError('slow down', 429, { code: 'HTTP_ERROR' }), 'limited', true],
    [new ApiError('forbidden', 403, { code: 'HTTP_ERROR' }), 'rejected', false],
    [new ApiError('invalid', 400, { code: 'VALIDATION_FAILED' }), 'rejected', false],
    [new Error('bug'), 'unavailable', true],
  ])('%s → %s', (error, kind, retryable) => {
    expect(describeCombatFailure(error)).toMatchObject({ kind, retryable });
  });
});

describe('isTransientFailure', () => {
  it('retries lost connections and gateway failures only', () => {
    expect(isTransientFailure(new ApiError('offline'))).toBe(true);
    expect(isTransientFailure(new ApiError('down', 503))).toBe(true);
    expect(isTransientFailure(new ApiError('bug', 500))).toBe(false);
    expect(isTransientFailure(new ApiError('busy', 409))).toBe(false);
  });
});

describe('localReadyAt', () => {
  it('reads the server’s wait relative to its own clock, anchored to arrival', () => {
    expect(localReadyAt('2026-09-22T10:00:14.000Z', '2026-09-22T10:00:10.000Z', 1_000_000)).toBe(
      1_004_000,
    );
  });

  it('ignores how wrong the device clock is', () => {
    const skewedArrival = Date.parse('1999-01-01T00:00:00.000Z');
    expect(
      localReadyAt('2026-09-22T10:00:14.000Z', '2026-09-22T10:00:10.000Z', skewedArrival),
    ).toBe(skewedArrival + 4_000);
  });
});
