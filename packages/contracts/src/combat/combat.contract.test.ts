import { describe, expect, it } from 'vitest';
import { combatResponseSchema, idempotencyKeySchema } from './combat.contract.js';

const character = {
  id: '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817',
  slot: 1,
  name: 'Ember',
  level: 1,
  experience: '3e0',
  gold: '5e0',
  createdAt: '2026-09-23T10:00:00.000Z',
};

const response = {
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
      { timeMs: 1250, attacker: 'ENEMY', critical: true, damage: '6e0', targetHealth: '9.4e1' },
    ],
    rewards: { gold: '5e0', experience: '3e0', item: null },
    levelsGained: 0,
    resolvedAt: '2026-09-23T10:00:00.000Z',
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
  character,
  progression: {
    currentStage: '2',
    highestStageReached: '2',
    highestStageCleared: '1',
    stageMode: 'PROGRESS',
    experienceToNextLevel: '1e1',
    hero: { maxHealth: '1e2', damage: '1e1' },
    encounter: {
      stage: { number: '2', kind: 'REGULAR' },
      enemy: { archetypeId: 'husk', maxHealth: '4.48e1', damage: '4.36e0' },
    },
    nextCombatAt: '2026-09-23T10:00:04.000Z',
  },
  serverTime: '2026-09-23T10:00:00.000Z',
};

describe('combatResponseSchema', () => {
  it('accepts a well formed combat', () => {
    expect(combatResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts authoritative metadata for a newly persisted item reward', () => {
    const item = {
      id: '2d9f1a52-3c4b-4e8d-9a1f-2b3c4d5e6f71',
      definitionId: 'ashsteel_cuirass',
      rarity: 'RARE' as const,
      nameKey: 'item.ashsteel_cuirass.name',
      slot: 'CHEST' as const,
      createdAt: '2026-09-23T10:00:00.000Z',
    };
    const withItem = {
      ...response,
      combat: { ...response.combat, rewards: { ...response.combat.rewards, item } },
    };
    expect(combatResponseSchema.parse(withItem).combat.rewards.item).toEqual(item);
  });

  it.each([
    ['an unknown outcome', { outcome: 'DRAW' }],
    ['a negative duration', { durationMs: -1 }],
    ['a fractional duration', { durationMs: 1.5 }],
    ['a numeric reward', { rewards: { gold: 5, experience: '3e0', item: null } }],
    ['a negative reward', { rewards: { gold: '-5e0', experience: '3e0', item: null } }],
    ['a numeric stage', { stage: { number: 1, kind: 'REGULAR' } }],
  ])('rejects %s', (_label, change) => {
    const result = combatResponseSchema.safeParse({
      ...response,
      combat: { ...response.combat, ...change },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['a current stage beyond the record', { currentStage: '3' }],
    ['a clear beyond the record', { highestStageCleared: '3' }],
    ['a numeric record', { highestStageReached: 2 }],
  ])('rejects a snapshot with %s', (_label, change) => {
    const result = combatResponseSchema.safeParse({
      ...response,
      after: { ...response.after, ...change },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a boss defeat: back to farm, records kept', () => {
    const after = {
      ...response.after,
      currentStage: '9',
      highestStageReached: '10',
      highestStageCleared: '9',
    };
    expect(combatResponseSchema.parse({ ...response, after }).after).toEqual(after);
  });

  it('bounds the event timeline', () => {
    const event = response.combat.events[0];
    const result = combatResponseSchema.safeParse({
      ...response,
      combat: { ...response.combat, events: Array.from({ length: 1_001 }, () => event) },
    });
    expect(result.success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('accepts a UUID', () => {
    expect(idempotencyKeySchema.parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
  });

  it.each(['', 'retry-1', '3f2504e0', 'a'.repeat(36), "'; DROP TABLE combat_runs; --"])(
    'rejects %j',
    (value) => {
      expect(idempotencyKeySchema.safeParse(value).success).toBe(false);
    },
  );
});
