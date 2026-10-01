import { SKILL_LOADOUT_MAX_SIZE } from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import { setSkillLoadoutRequestSchema, skillStateResponseSchema } from './skill.contract.js';

const fireball = { skillId: 'fireball', nameKey: 'skill.fireball.name', level: 1 };
const execute = { skillId: 'execute', nameKey: 'skill.execute.name', level: 3 };

function state(overrides: Record<string, unknown> = {}) {
  return {
    characterVersion: '7',
    maxLoadoutSize: SKILL_LOADOUT_MAX_SIZE,
    owned: [fireball, execute],
    loadout: [
      { ...execute, priority: 0 },
      { ...fireball, priority: 1 },
    ],
    ...overrides,
  };
}

describe('setSkillLoadoutRequestSchema', () => {
  it('accepts an ordered list of canonical skill IDs, including an empty one', () => {
    expect(setSkillLoadoutRequestSchema.parse({ skillIds: ['execute', 'fireball'] })).toEqual({
      skillIds: ['execute', 'fireball'],
    });
    expect(setSkillLoadoutRequestSchema.parse({ skillIds: [] })).toEqual({ skillIds: [] });
  });

  it.each(['Fireball', 'blood-strike', '', ' fireball', 'a'.repeat(65), 'fire__ball'])(
    'rejects the malformed ID %j',
    (skillId) => {
      expect(setSkillLoadoutRequestSchema.safeParse({ skillIds: [skillId] }).success).toBe(false);
    },
  );

  it('rejects non-string entries and a missing or non-array list', () => {
    expect(setSkillLoadoutRequestSchema.safeParse({ skillIds: [1] }).success).toBe(false);
    expect(setSkillLoadoutRequestSchema.safeParse({ skillIds: 'fireball' }).success).toBe(false);
    expect(setSkillLoadoutRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects more skills than the Game Core maximum and duplicates', () => {
    const tooMany = ['whirlwind', 'fireball', 'execute', 'blood_strike', 'shield'];
    expect(tooMany.length).toBe(SKILL_LOADOUT_MAX_SIZE + 1);
    expect(setSkillLoadoutRequestSchema.safeParse({ skillIds: tooMany }).success).toBe(false);
    expect(
      setSkillLoadoutRequestSchema.safeParse({ skillIds: ['fireball', 'fireball'] }).success,
    ).toBe(false);
  });

  it('rejects client-authoritative fields: levels, priorities, positions, ownership', () => {
    for (const extra of [
      { levels: [5] },
      { priorities: [0] },
      { positions: [0] },
      { owned: ['fireball'] },
      { characterVersion: '3' },
    ]) {
      expect(
        setSkillLoadoutRequestSchema.safeParse({ skillIds: ['fireball'], ...extra }).success,
      ).toBe(false);
    }
    expect(
      setSkillLoadoutRequestSchema.safeParse({ skillIds: [{ skillId: 'fireball', level: 9 }] })
        .success,
    ).toBe(false);
  });
});

describe('skillStateResponseSchema', () => {
  it('accepts a coherent state and the empty state', () => {
    expect(skillStateResponseSchema.parse(state())).toEqual(state());
    expect(
      skillStateResponseSchema.parse(state({ owned: [], loadout: [], characterVersion: '0' })),
    ).toMatchObject({ owned: [], loadout: [] });
  });

  it('rejects incoherent states', () => {
    for (const broken of [
      state({ owned: [fireball, fireball], loadout: [] }),
      state({ loadout: [{ ...execute, priority: 1 }] }),
      state({
        loadout: [
          { ...execute, priority: 0 },
          { ...execute, priority: 1 },
        ],
      }),
      state({
        loadout: [{ skillId: 'shield', nameKey: 'skill.shield.name', level: 1, priority: 0 }],
      }),
      state({ loadout: [{ ...execute, level: 4, priority: 0 }] }),
      state({ maxLoadoutSize: 1 }),
      state({ characterVersion: '-1' }),
      state({ owned: [{ ...fireball, level: 0 }], loadout: [] }),
      state({ seed: 'x' }),
    ]) {
      expect(skillStateResponseSchema.safeParse(broken).success).toBe(false);
    }
  });
});
