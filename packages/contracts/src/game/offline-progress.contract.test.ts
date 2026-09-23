import { describe, expect, it } from 'vitest';
import {
  offlineProgressResponseSchema,
  offlineProgressSchema,
  type OfflineProgressDto,
} from './offline-progress.contract.js';

const collected: OfflineProgressDto = {
  id: '5b0c3f59-7c7e-4a57-9c1a-1f4f0c2f8e11',
  idleSince: '2026-09-22T22:00:00.000Z',
  claimedAt: '2026-09-23T12:32:00.000Z',
  elapsedMs: 52_320_000,
  rewardedMs: 28_800_000,
  capMs: 28_800_000,
  capReached: true,
  processedUntil: '2026-09-23T12:31:59.200Z',
  targetStage: { number: '9007199254740993', kind: 'REGULAR' },
  idleReason: null,
  fights: 186,
  wins: 181,
  losses: 5,
  rewards: { gold: '1.234e56', experience: '9.87e20' },
  levelsGained: 3,
};

const nothing: OfflineProgressDto = {
  ...collected,
  id: null,
  elapsedMs: 700,
  rewardedMs: 700,
  capReached: false,
  processedUntil: collected.idleSince,
  targetStage: null,
  idleReason: 'NO_CLEARED_STAGE',
  fights: 0,
  wins: 0,
  losses: 0,
  rewards: { gold: '0', experience: '0' },
  levelsGained: 0,
};

describe('offlineProgressSchema (ADR-023)', () => {
  it('accepts a collected claim, keeping a stage beyond 2^53 exact', () => {
    const parsed = offlineProgressSchema.parse(collected);
    expect(parsed).toEqual(collected);
    expect(parsed.targetStage?.number).toBe('9007199254740993');
  });

  it('accepts a claim with nothing to collect', () => {
    expect(offlineProgressSchema.parse(nothing)).toEqual(nothing);
  });

  it.each([
    ['wins and losses that do not add up', { ...collected, losses: 6 }],
    ['fights without an explanation-free result', { ...collected, idleReason: 'TOO_SOON' }],
    ['no fights without a reason', { ...nothing, idleReason: null }],
    ['more rewarded time than elapsed', { ...collected, rewardedMs: 60_000_000 }],
    [
      'more rewarded time than the cap',
      { ...collected, elapsedMs: 90_000_000, rewardedMs: 30_000_000 },
    ],
    ['negative elapsed time', { ...collected, elapsedMs: -1 }],
    ['fractional milliseconds', { ...collected, rewardedMs: 1.5 }],
    ['an unknown idle reason', { ...nothing, idleReason: 'OFFLINE' }],
    ['a floating-point reward', { ...collected, rewards: { gold: 1e56, experience: '1' } }],
    ['a numeric stage', { ...collected, targetStage: { number: 9, kind: 'REGULAR' } }],
    ['a non-ISO time', { ...collected, claimedAt: 'yesterday' }],
  ])('rejects %s', (_label, value) => {
    expect(offlineProgressSchema.safeParse(value).success).toBe(false);
  });
});

describe('offlineProgressResponseSchema', () => {
  const response = {
    offline: collected,
    character: {
      id: '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817',
      slot: 1,
      name: 'Kael',
      level: 33,
      experience: '0',
      gold: '1.5e3',
      createdAt: '2026-09-22T10:00:00.000Z',
    },
    progression: {
      currentStage: '10',
      highestStageReached: '10',
      highestStageCleared: '9',
      stageMode: 'PROGRESS',
      experienceToNextLevel: '1e1',
      hero: { maxHealth: '1e2', damage: '1e1' },
      encounter: {
        stage: { number: '10', kind: 'BOSS' },
        enemy: { archetypeId: 'warden', maxHealth: '4e1', damage: '4e0' },
      },
      nextCombatAt: collected.processedUntil,
    },
    serverTime: collected.claimedAt,
  };

  it('accepts the authoritative state after a claim', () => {
    expect(offlineProgressResponseSchema.parse(response)).toEqual(response);
  });
});
