import type { CombatResponse, PlayerStateResponse } from '@eternal-forge/contracts';

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
