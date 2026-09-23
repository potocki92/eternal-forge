import type {
  CombatResponse,
  OfflineProgressResponse,
  PlayerStateResponse,
} from '@eternal-forge/contracts';

/**
 * Wire-format fixtures shaped exactly like the API's responses. Tests that
 * render or parse server state start from these, so a contract change breaks
 * one place instead of every test.
 */

export const CHARACTER_ID = '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817';

export function playerStateFixture(): PlayerStateResponse {
  return {
    profile: {
      id: '5b0c8a3e-1f7b-4c1e-9a53-0d6f3c2b1a90',
      displayName: 'Kael',
      createdAt: '2026-09-22T10:00:00.000Z',
    },
    character: {
      id: CHARACTER_ID,
      slot: 1,
      name: 'Ember',
      level: 1,
      experience: '0',
      gold: '0',
      createdAt: '2026-09-22T10:00:00.000Z',
    },
    progression: {
      currentStage: '1',
      highestStageReached: '1',
      highestStageCleared: null,
      stageMode: 'PROGRESS',
      experienceToNextLevel: '1e1',
      hero: { maxHealth: '1e2', damage: '1e1' },
      encounter: {
        stage: { number: '1', kind: 'REGULAR' },
        enemy: { archetypeId: 'husk', maxHealth: '4e1', damage: '4e0' },
      },
      nextCombatAt: '2026-09-22T10:00:00.000Z',
    },
    serverTime: '2026-09-22T10:00:00.000Z',
  };
}

/** A stage-1 win: four hero hits kill the husk; the husk lands three. */
export function combatResponseFixture(): CombatResponse {
  const state = playerStateFixture();
  return {
    combat: {
      id: '7d9f1a52-3c4b-4e8d-9a1f-2b3c4d5e6f70',
      stage: { number: '1', kind: 'REGULAR' },
      enemy: { archetypeId: 'husk', maxHealth: '4e1', damage: '4e0' },
      hero: { maxHealth: '1e2', damage: '1e1' },
      outcome: 'WIN',
      endReason: 'ENEMY_DEFEATED',
      durationMs: 4000,
      events: [
        { timeMs: 1000, attacker: 'PLAYER', critical: false, damage: '1e1', targetHealth: '3e1' },
        { timeMs: 1250, attacker: 'ENEMY', critical: false, damage: '4e0', targetHealth: '9.6e1' },
        {
          timeMs: 2000,
          attacker: 'PLAYER',
          critical: true,
          damage: '1.5e1',
          targetHealth: '1.5e1',
        },
        { timeMs: 2500, attacker: 'ENEMY', critical: false, damage: '4e0', targetHealth: '9.2e1' },
        { timeMs: 3000, attacker: 'PLAYER', critical: false, damage: '1e1', targetHealth: '5e0' },
        { timeMs: 3750, attacker: 'ENEMY', critical: false, damage: '4e0', targetHealth: '8.8e1' },
        { timeMs: 4000, attacker: 'PLAYER', critical: false, damage: '1e1', targetHealth: '0' },
      ],
      rewards: { gold: '5e0', experience: '3e0' },
      levelsGained: 0,
      resolvedAt: '2026-09-22T10:00:10.000Z',
    },
    before: {
      level: 1,
      experience: '0',
      experienceToNextLevel: '1e1',
      gold: '0',
      currentStage: '1',
      highestStageReached: '1',
      highestStageCleared: null,
    },
    after: {
      level: 1,
      experience: '3e0',
      experienceToNextLevel: '1e1',
      gold: '5e0',
      currentStage: '2',
      highestStageReached: '2',
      highestStageCleared: '1',
    },
    character: { ...state.character, experience: '3e0', gold: '5e0' },
    progression: {
      ...state.progression,
      stageMode: 'PROGRESS',
      currentStage: '2',
      highestStageReached: '2',
      highestStageCleared: '1',
      encounter: {
        stage: { number: '2', kind: 'REGULAR' },
        enemy: { archetypeId: 'husk', maxHealth: '4.48e1', damage: '4.36e0' },
      },
      nextCombatAt: '2026-09-22T10:00:14.000Z',
    },
    serverTime: '2026-09-22T10:00:10.000Z',
  };
}

/**
 * The answer to an offline claim: `nothing` (no stage cleared yet), or a
 * collected claim of three hours on stage 1 that paid 120 gold.
 */
export function offlineProgressFixture(
  kind: 'nothing' | 'collected' = 'nothing',
): OfflineProgressResponse {
  const state = playerStateFixture();
  const base = {
    character: state.character,
    progression: state.progression,
    serverTime: state.serverTime,
  };
  if (kind === 'nothing') {
    return {
      ...base,
      offline: {
        id: null,
        idleSince: state.progression.nextCombatAt,
        claimedAt: state.serverTime,
        elapsedMs: 0,
        rewardedMs: 0,
        capMs: 28_800_000,
        capReached: false,
        processedUntil: state.progression.nextCombatAt,
        targetStage: null,
        idleReason: 'NO_CLEARED_STAGE',
        fights: 0,
        wins: 0,
        losses: 0,
        rewards: { gold: '0', experience: '0' },
        levelsGained: 0,
      },
    };
  }
  return {
    ...base,
    character: { ...state.character, level: 4, gold: '1.2e2' },
    offline: {
      id: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      idleSince: '2026-09-22T07:00:00.000Z',
      claimedAt: state.serverTime,
      elapsedMs: 13_320_000,
      rewardedMs: 13_320_000,
      capMs: 28_800_000,
      capReached: false,
      processedUntil: state.progression.nextCombatAt,
      targetStage: { number: '1', kind: 'REGULAR' },
      idleReason: null,
      fights: 24,
      wins: 24,
      losses: 0,
      rewards: { gold: '1.2e2', experience: '7.2e1' },
      levelsGained: 3,
    },
  };
}
