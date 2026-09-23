import { describe, expect, it } from 'vitest';
import {
  stageSelectionRequestSchema,
  stageSelectionResponseSchema,
} from './stage-selection.contract.js';

describe('stageSelectionRequestSchema (ADR-021)', () => {
  it.each([
    [{ mode: 'PROGRESS' }],
    [{ mode: 'FARM', stage: '1' }],
    [{ mode: 'FARM', stage: '42' }],
    [{ mode: 'FARM', stage: '9007199254740993' }],
    [{ mode: 'FARM', stage: '9223372036854775807' }],
  ])('accepts %j', (body) => {
    expect(stageSelectionRequestSchema.parse(body)).toEqual(body);
  });

  it('keeps a stage beyond 2^53 exact: it stays a string', () => {
    const parsed = stageSelectionRequestSchema.parse({ mode: 'FARM', stage: '9007199254740993' });
    expect(parsed.mode === 'FARM' && parsed.stage).toBe('9007199254740993');
  });

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['an unknown mode', { mode: 'CLIMB' }],
    ['a lower-case mode', { mode: 'farm', stage: '3' }],
    ['a farm without a stage', { mode: 'FARM' }],
    ['a numeric stage', { mode: 'FARM', stage: 3 }],
    ['stage zero', { mode: 'FARM', stage: '0' }],
    ['a negative stage', { mode: 'FARM', stage: '-1' }],
    ['a leading zero', { mode: 'FARM', stage: '03' }],
    ['an exponent', { mode: 'FARM', stage: '1e3' }],
    ['a fraction', { mode: 'FARM', stage: '1.5' }],
    ['beyond 2^63 − 1', { mode: 'FARM', stage: '9223372036854775808' }],
    ['an absurdly long stage', { mode: 'FARM', stage: '9'.repeat(10_000) }],
    ['a stage when climbing', { mode: 'PROGRESS', stage: '5' }],
    ['a forged record', { mode: 'FARM', stage: '3', highestStageCleared: '999999' }],
    ['a forged reward', { mode: 'PROGRESS', gold: '1e30' }],
    ['an identity field', { mode: 'PROGRESS', characterId: 'x' }],
    ['an array', [{ mode: 'PROGRESS' }]],
  ])('rejects %s', (_label, body) => {
    expect(stageSelectionRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('stageSelectionResponseSchema', () => {
  const response = {
    character: {
      id: '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817',
      slot: 1,
      name: 'Kael',
      level: 30,
      experience: '0',
      gold: '1.5e3',
      createdAt: '2026-09-22T10:00:00.000Z',
    },
    progression: {
      currentStage: '99',
      highestStageReached: '100',
      highestStageCleared: '99',
      stageMode: 'FARM',
      experienceToNextLevel: '1e1',
      hero: { maxHealth: '1e2', damage: '1e1' },
      encounter: {
        stage: { number: '99', kind: 'REGULAR' },
        enemy: { archetypeId: 'husk', maxHealth: '4e1', damage: '4e0' },
      },
      nextCombatAt: '2026-09-22T10:00:00.000Z',
    },
    serverTime: '2026-09-22T10:00:00.000Z',
  };

  it('accepts the authoritative state after a selection', () => {
    expect(stageSelectionResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a farm stage beyond the highest stage reached', () => {
    expect(
      stageSelectionResponseSchema.safeParse({
        ...response,
        progression: { ...response.progression, currentStage: '101' },
      }).success,
    ).toBe(false);
  });
});
