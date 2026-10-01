import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { getGameRules, supportedRulesVersions } from '../rules/index.js';
import {
  SKILL_CATALOG,
  SKILL_DEFINITION_ID_MAX_LENGTH,
  SKILL_LEVEL_MAX,
  SkillCatalog,
  SkillDefinitionId,
  SkillLevel,
  createSkillDefinition,
} from './index.js';

function expectCode(operation: () => unknown, code: GameCoreErrorCode): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('SkillDefinitionId', () => {
  it.each(['whirlwind', 'blood_strike', 'lightning_chain', 'a', 'skill2', 'x_1'])(
    'accepts the canonical key %j and round-trips it',
    (value) => {
      const id = SkillDefinitionId.parse(value);
      expect(id.toString()).toBe(value);
      expect(JSON.stringify(id)).toBe(JSON.stringify(value));
      expect(id.equals(SkillDefinitionId.parse(value))).toBe(true);
      expect(Object.isFrozen(id)).toBe(true);
    },
  );

  it.each([
    '',
    'Whirlwind',
    'Blood Strike',
    'blood-strike',
    'blood__strike',
    '_shield',
    'shield_',
    '1fireball',
    ' fireball',
    'fireball ',
    'ﬁreball',
    'a'.repeat(SKILL_DEFINITION_ID_MAX_LENGTH + 1),
  ])('rejects %j', (value) => {
    expectCode(() => SkillDefinitionId.parse(value), 'INVALID_FORMAT');
  });

  it('accepts the maximum length', () => {
    expect(
      SkillDefinitionId.parse('a'.repeat(SKILL_DEFINITION_ID_MAX_LENGTH)).toString(),
    ).toHaveLength(SKILL_DEFINITION_ID_MAX_LENGTH);
  });

  it('compares by value', () => {
    expect(SkillDefinitionId.parse('fireball').equals(SkillDefinitionId.parse('shield'))).toBe(
      false,
    );
  });
});

describe('createSkillDefinition', () => {
  it('builds a frozen identity-only definition', () => {
    const definition = createSkillDefinition({ id: 'fireball', nameKey: 'skill.fireball.name' });
    expect(definition.id.toString()).toBe('fireball');
    expect(definition.nameKey).toBe('skill.fireball.name');
    expect(Object.keys(definition).sort()).toEqual(['id', 'nameKey']);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it.each(['skill.shield.name', 'fireball', 'skill.fireball', 'item.fireball.name', ''])(
    'rejects the name key %j for fireball',
    (nameKey) => {
      expectCode(() => createSkillDefinition({ id: 'fireball', nameKey }), 'INVALID_FORMAT');
    },
  );
});

describe('SKILL_CATALOG', () => {
  it('registers exactly the six documented candidates, in stable declaration order', () => {
    expect(SKILL_CATALOG.definitions().map((definition) => definition.id.toString())).toEqual([
      'whirlwind',
      'fireball',
      'execute',
      'blood_strike',
      'lightning_chain',
      'shield',
    ]);
  });

  it('gives every candidate a unique ID and its canonical name key', () => {
    const definitions = SKILL_CATALOG.definitions();
    expect(new Set(definitions.map((definition) => definition.id.toString())).size).toBe(
      definitions.length,
    );
    for (const definition of definitions) {
      expect(definition.nameKey).toBe(`skill.${definition.id.toString()}.name`);
    }
  });

  it('carries identity only: no cooldown, damage or effect is pretended', () => {
    for (const definition of SKILL_CATALOG.definitions()) {
      expect(Object.keys(definition).sort()).toEqual(['id', 'nameKey']);
    }
  });

  it('looks definitions up by identity', () => {
    const id = SkillDefinitionId.parse('blood_strike');
    expect(SKILL_CATALOG.get(id)?.nameKey).toBe('skill.blood_strike.name');
    expect(SKILL_CATALOG.require(id)).toBe(SKILL_CATALOG.get(id));
    expect(SKILL_CATALOG.get(SkillDefinitionId.parse('meteor'))).toBeUndefined();
    expectCode(
      () => SKILL_CATALOG.require(SkillDefinitionId.parse('meteor')),
      'UNKNOWN_SKILL_DEFINITION',
    );
  });

  it('does not leak mutable state', () => {
    const definitions = SKILL_CATALOG.definitions();
    expect(Object.isFrozen(SKILL_CATALOG)).toBe(true);
    expect(Object.isFrozen(definitions)).toBe(true);
    for (const definition of definitions) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Reflect.set(definition, 'nameKey', 'skill.meteor.name')).toBe(false);
    }
    expect(Reflect.set(definitions, '6', definitions[0])).toBe(false);
    expect(SKILL_CATALOG.definitions()).toHaveLength(6);
  });

  it('is unaffected by later mutation of its input', () => {
    const inputs = [{ id: 'fireball', nameKey: 'skill.fireball.name' }];
    const catalog = new SkillCatalog(inputs);
    inputs.push({ id: 'shield', nameKey: 'skill.shield.name' });
    expect(catalog.definitions()).toHaveLength(1);
  });

  it('rejects duplicate identities', () => {
    const entry = { id: 'fireball', nameKey: 'skill.fireball.name' };
    expectCode(() => new SkillCatalog([entry, entry]), 'DUPLICATE_SKILL_DEFINITION');
  });

  it('rejects an invalid definition', () => {
    expectCode(
      () => new SkillCatalog([{ id: 'Fire Ball', nameKey: 'skill.Fire Ball.name' }]),
      'INVALID_FORMAT',
    );
  });
});

describe('SkillLevel', () => {
  it.each([1, 2, 17, 1_000_000, SKILL_LEVEL_MAX])('accepts level %d', (value) => {
    const level = SkillLevel.of(value);
    expect(level.toNumber()).toBe(value);
    expect(JSON.stringify(level)).toBe(String(value));
    expect(level.equals(SkillLevel.of(value))).toBe(true);
    expect(Object.isFrozen(level)).toBe(true);
  });

  it('has one shared first level', () => {
    expect(SkillLevel.of(1)).toBe(SkillLevel.FIRST);
    expect(SkillLevel.FIRST.toNumber()).toBe(1);
  });

  it('bounds levels by the PostgreSQL integer range, not an invented balance cap', () => {
    expect(SKILL_LEVEL_MAX).toBe(2 ** 31 - 1);
  });

  it.each([0, -1, SKILL_LEVEL_MAX + 1, Number.MAX_SAFE_INTEGER])(
    'rejects the out-of-range level %d',
    (value) => {
      expectCode(() => SkillLevel.of(value), 'OUT_OF_RANGE');
    },
  );

  it.each([1.5, 0.999, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects the non-integer or unsafe level %d',
    (value) => {
      expectCode(() => SkillLevel.of(value), 'NOT_A_SAFE_INTEGER');
    },
  );
});

describe('skills and the executable rule sets', () => {
  it('leaves GAME_RULES_VERSION at 3', () => {
    expect(GAME_RULES_VERSION).toBe(3);
    expect(supportedRulesVersions()).toEqual([1, 2, 3]);
  });

  it('adds no skill rules to any historical rule set (ADR-031)', () => {
    for (const version of supportedRulesVersions()) {
      expect(Object.keys(getGameRules(version))).not.toContain('skills');
    }
  });
});
