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
    stage: 1,
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  serverTime: '2026-09-22T10:00:00.000Z',
};

describe('playerStateResponseSchema', () => {
  it('accepts a well formed payload', () => {
    expect(playerStateResponseSchema.parse(state)).toEqual(state);
  });

  it('rejects a stage beyond the safe-integer wire range', () => {
    const result = playerStateResponseSchema.safeParse({
      ...state,
      character: { ...state.character, stage: 2 ** 53 },
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
