import { describe, expect, it } from 'vitest';
import { playerStateResponseSchema, provisionPlayerRequestSchema } from './player.contract.js';

const state = {
  profile: {
    id: '5b0c8a3e-1f7b-4c1e-9a53-0d6f3c2b1a90',
    displayName: 'Kael',
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  character: {
    id: '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817',
    slot: 1,
    name: 'Kael',
    level: 1,
    stage: '1',
    experience: '0',
    gold: '1.5e3',
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  progression: {
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

describe('playerStateResponseSchema', () => {
  it('accepts a well formed payload', () => {
    expect(playerStateResponseSchema.parse(state)).toEqual(state);
  });

  it('carries stages beyond 2^53 exactly, as strings', () => {
    const character = { ...state.character, stage: '9007199254740993' };

    expect(playerStateResponseSchema.parse({ ...state, character }).character.stage).toBe(
      '9007199254740993',
    );
  });

  it('rejects a numeric stage, which JSON cannot carry exactly', () => {
    const result = playerStateResponseSchema.safeParse({
      ...state,
      character: { ...state.character, stage: 1 },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ['a numeric gold amount', { gold: 1500 }],
    ['a non-canonical gold amount', { gold: '1500' }],
    ['negative gold', { gold: '-1e0' }],
    ['negative experience', { experience: '-5e0' }],
  ])('rejects %s', (_label, change) => {
    const result = playerStateResponseSchema.safeParse({
      ...state,
      character: { ...state.character, ...change },
    });

    expect(result.success).toBe(false);
  });

  it('rejects a stage kind the rule set does not define', () => {
    const result = playerStateResponseSchema.safeParse({
      ...state,
      progression: {
        ...state.progression,
        encounter: { ...state.progression.encounter, stage: { number: '10', kind: 'ELITE' } },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('provisionPlayerRequestSchema', () => {
  it('normalises both names', () => {
    expect(
      provisionPlayerRequestSchema.parse({ displayName: ' Kael ', characterName: 'Ember' }),
    ).toEqual({ displayName: 'Kael', characterName: 'Ember' });
  });

  it('rejects identity fields: the caller is never named by the client', () => {
    const result = provisionPlayerRequestSchema.safeParse({
      displayName: 'Kael',
      characterName: 'Ember',
      authUserId: '5b0c8a3e-1f7b-4c1e-9a53-0d6f3c2b1a90',
    });

    expect(result.success).toBe(false);
  });
});
