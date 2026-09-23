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
    experience: '0',
    gold: '1.5e3',
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

describe('playerStateResponseSchema', () => {
  it('accepts a well formed payload', () => {
    expect(playerStateResponseSchema.parse(state)).toEqual(state);
  });

  it('supports a character that has cleared nothing yet', () => {
    expect(playerStateResponseSchema.parse(state).progression.highestStageCleared).toBeNull();
  });

  it('carries the stage progress beyond 2^53 exactly, as strings', () => {
    const progression = {
      ...state.progression,
      currentStage: '9007199254740992',
      highestStageReached: '9007199254740994',
      highestStageCleared: '9007199254740993',
    };

    const parsed = playerStateResponseSchema.parse({ ...state, progression }).progression;
    expect([parsed.currentStage, parsed.highestStageReached, parsed.highestStageCleared]).toEqual([
      '9007199254740992',
      '9007199254740994',
      '9007199254740993',
    ]);
  });

  it.each([
    ['a numeric current stage', { currentStage: 1 }],
    ['a numeric record', { highestStageReached: 1 }],
    ['stage 0', { highestStageCleared: '0' }],
    ['a missing record', { highestStageReached: undefined }],
    ['a current stage beyond the highest reached', { currentStage: '2' }],
    [
      'a clear beyond the highest reached',
      { currentStage: '9', highestStageReached: '10', highestStageCleared: '11' },
    ],
    [
      'an inconsistency only visible beyond 2^53',
      { currentStage: '9007199254740993', highestStageReached: '9007199254740992' },
    ],
  ])('rejects %s', (_label, change) => {
    const result = playerStateResponseSchema.safeParse({
      ...state,
      progression: { ...state.progression, ...change },
    });

    expect(result.success).toBe(false);
  });

  it('carries no stage on the character: progress lives in progression', () => {
    const parsed = playerStateResponseSchema.parse({
      ...state,
      character: { ...state.character, stage: '5' },
    });
    expect(parsed.character).not.toHaveProperty('stage');
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

describe('progression.stageMode (ADR-021)', () => {
  it.each(['PROGRESS', 'FARM'])('accepts %s', (stageMode) => {
    expect(
      playerStateResponseSchema.parse({
        ...state,
        progression: { ...state.progression, stageMode },
      }).progression.stageMode,
    ).toBe(stageMode);
  });

  it.each([['farm'], ['CLIMB'], [''], [1], [null], [undefined]])('rejects %j', (stageMode) => {
    expect(
      playerStateResponseSchema.safeParse({
        ...state,
        progression: { ...state.progression, stageMode },
      }).success,
    ).toBe(false);
  });
});
