import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { offlineProgressFixture } from '@/test/fixtures';
import {
  OFFLINE_CLAIM_NEEDED,
  blocksFighting,
  describeOfflineClaimFailure,
  formatDuration,
  keyForNextClaim,
  offlineClaimReducer,
  type OfflineClaimState,
} from './offline-claim';

const collected = offlineProgressFixture('collected').offline;
const nothing = offlineProgressFixture('nothing').offline;

describe('offlineClaimReducer', () => {
  it('claims, then shows a summary that fought', () => {
    const claiming = offlineClaimReducer(OFFLINE_CLAIM_NEEDED, { type: 'claim', key: 'k' });
    expect(claiming).toEqual({ status: 'claiming', key: 'k' });
    const shown = offlineClaimReducer(claiming, { type: 'answer', summary: collected });
    expect(shown).toEqual({ status: 'shown', summary: collected });
    expect(offlineClaimReducer(shown, { type: 'dismiss' })).toEqual({ status: 'settled' });
  });

  it('settles silently when there was nothing to collect', () => {
    const claiming = offlineClaimReducer(OFFLINE_CLAIM_NEEDED, { type: 'claim', key: 'k' });
    expect(offlineClaimReducer(claiming, { type: 'answer', summary: nothing })).toEqual({
      status: 'settled',
    });
  });

  it('keeps the failed key for a retry', () => {
    const claiming = offlineClaimReducer(OFFLINE_CLAIM_NEEDED, { type: 'claim', key: 'same' });
    const failed = offlineClaimReducer(claiming, {
      type: 'fail',
      failure: { message: 'x', retryable: true },
    });
    expect(keyForNextClaim(failed, () => 'fresh')).toBe('same');
    expect(keyForNextClaim({ status: 'settled' }, () => 'fresh')).toBe('fresh');
  });

  it('asks again after an absence only once the previous claim is settled', () => {
    const settled: OfflineClaimState = { status: 'settled' };
    expect(offlineClaimReducer(settled, { type: 'need' })).toEqual(OFFLINE_CLAIM_NEEDED);
    const claiming: OfflineClaimState = { status: 'claiming', key: 'k' };
    expect(offlineClaimReducer(claiming, { type: 'need' })).toBe(claiming);
  });

  it('ignores an answer that arrives when nothing is in flight', () => {
    const settled: OfflineClaimState = { status: 'settled' };
    expect(offlineClaimReducer(settled, { type: 'answer', summary: collected })).toBe(settled);
  });

  it('blocks fighting only while a claim is due or in flight', () => {
    expect(blocksFighting(OFFLINE_CLAIM_NEEDED)).toBe(true);
    expect(blocksFighting({ status: 'claiming', key: 'k' })).toBe(true);
    expect(blocksFighting({ status: 'shown', summary: collected })).toBe(false);
    expect(
      blocksFighting({ status: 'failed', key: 'k', failure: { message: 'x', retryable: true } }),
    ).toBe(false);
  });
});

describe('describeOfflineClaimFailure', () => {
  it('lets a lost connection or an outage be retried', () => {
    expect(describeOfflineClaimFailure(new ApiError('down')).retryable).toBe(true);
    expect(describeOfflineClaimFailure(new ApiError('down', 503)).retryable).toBe(true);
  });

  it('lets a busy hero be retried, but not a refusal', () => {
    expect(
      describeOfflineClaimFailure(new ApiError('busy', 409, { code: 'CONCURRENT_UPDATE' }))
        .retryable,
    ).toBe(true);
    expect(describeOfflineClaimFailure(new ApiError('gone', 404)).retryable).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45_000, '45s'],
    [12 * 60_000 + 5_000, '12m'],
    [3 * 3_600_000 + 42 * 60_000, '3h 42m'],
    [8 * 3_600_000, '8h'],
    [-5, '0s'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
