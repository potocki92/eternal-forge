import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import {
  SKILL_CATALOG,
  SKILL_LOADOUT_MAX_SIZE,
  SkillCatalog,
  SkillDefinitionId,
  SkillLevel,
  createCharacterSkills,
  replaceSkillLoadout,
  sameSkillLoadout,
  type OwnedSkill,
} from './index.js';

function expectCode(operation: () => unknown, code: GameCoreErrorCode): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

const id = (value: string) => SkillDefinitionId.parse(value);
const own = (value: string, level = 1): OwnedSkill => ({
  id: id(value),
  level: SkillLevel.of(level),
});
const ids = (skills: readonly OwnedSkill[]) => skills.map((skill) => skill.id.toString());

describe('SKILL_LOADOUT_MAX_SIZE', () => {
  it('is the Phase 7 product decision of four skills (ADR-032)', () => {
    expect(SKILL_LOADOUT_MAX_SIZE).toBe(4);
  });
});

describe('createCharacterSkills', () => {
  it('accepts the empty state: no skills owned, nothing equipped', () => {
    const skills = createCharacterSkills({ owned: [], loadout: [] });
    expect(skills).toEqual({ owned: [], loadout: [] });
    expect(Object.isFrozen(skills)).toBe(true);
    expect(Object.isFrozen(skills.owned)).toBe(true);
    expect(Object.isFrozen(skills.loadout)).toBe(true);
  });

  it('accepts owned skills with an empty loadout', () => {
    const skills = createCharacterSkills({ owned: [own('fireball', 5)], loadout: [] });
    expect(ids(skills.owned)).toEqual(['fireball']);
    expect(skills.owned[0]?.level.toNumber()).toBe(5);
    expect(skills.loadout).toEqual([]);
  });

  it('orders owned skills by catalog declaration, never by input order', () => {
    const skills = createCharacterSkills({
      owned: [own('shield', 2), own('whirlwind'), own('execute', 3), own('fireball')],
      loadout: [],
    });
    expect(ids(skills.owned)).toEqual(['whirlwind', 'fireball', 'execute', 'shield']);
  });

  it('keeps the loadout in the given priority order, with each skill’s owned level', () => {
    const skills = createCharacterSkills({
      owned: [own('fireball', 1), own('execute', 3), own('shield', 2)],
      loadout: [id('execute'), id('fireball'), id('shield')],
    });
    expect(ids(skills.loadout)).toEqual(['execute', 'fireball', 'shield']);
    expect(skills.loadout.map((skill) => skill.level.toNumber())).toEqual([3, 1, 2]);
    expect(Object.isFrozen(skills.loadout[0])).toBe(true);
  });

  it('allows exactly the maximum loadout size', () => {
    const owned = ['whirlwind', 'fireball', 'execute', 'blood_strike'].map((skill) => own(skill));
    const skills = createCharacterSkills({ owned, loadout: owned.map((skill) => skill.id) });
    expect(skills.loadout).toHaveLength(SKILL_LOADOUT_MAX_SIZE);
  });

  it('refuses one skill more than the maximum', () => {
    const owned = SKILL_CATALOG.definitions().map((definition) => own(definition.id.toString()));
    expectCode(
      () =>
        createCharacterSkills({
          owned,
          loadout: owned.slice(0, SKILL_LOADOUT_MAX_SIZE + 1).map((skill) => skill.id),
        }),
      'SKILL_LOADOUT_TOO_LARGE',
    );
  });

  it('refuses a skill listed twice in the loadout', () => {
    expectCode(
      () =>
        createCharacterSkills({
          owned: [own('fireball'), own('execute')],
          loadout: [id('fireball'), id('execute'), id('fireball')],
        }),
      'DUPLICATE_SKILL',
    );
  });

  it('refuses a skill owned twice', () => {
    expectCode(
      () => createCharacterSkills({ owned: [own('fireball', 1), own('fireball', 2)], loadout: [] }),
      'DUPLICATE_SKILL',
    );
  });

  it('refuses a known skill the character does not own', () => {
    expectCode(
      () => createCharacterSkills({ owned: [own('fireball')], loadout: [id('shield')] }),
      'SKILL_NOT_OWNED',
    );
  });

  it('refuses a well-formed identity the catalog does not know, owned or equipped', () => {
    expectCode(
      () => createCharacterSkills({ owned: [own('meteor')], loadout: [] }),
      'UNKNOWN_SKILL_DEFINITION',
    );
    expectCode(
      () => createCharacterSkills({ owned: [own('fireball')], loadout: [id('meteor')] }),
      'UNKNOWN_SKILL_DEFINITION',
    );
  });

  it('reports a deterministic reason when several rules are broken', () => {
    // Too large and duplicated and unowned: size is checked first.
    expectCode(
      () =>
        createCharacterSkills({
          owned: [],
          loadout: ['fireball', 'fireball', 'meteor', 'shield', 'execute'].map(id),
        }),
      'SKILL_LOADOUT_TOO_LARGE',
    );
    // Duplicated and unknown: duplicates before catalog membership.
    expectCode(
      () => createCharacterSkills({ owned: [], loadout: ['meteor', 'meteor'].map(id) }),
      'DUPLICATE_SKILL',
    );
    // Unknown and unowned: catalog membership before ownership.
    expectCode(
      () => createCharacterSkills({ owned: [], loadout: ['shield', 'meteor'].map(id) }),
      'UNKNOWN_SKILL_DEFINITION',
    );
  });

  it('validates against the catalog it is given', () => {
    const catalog = new SkillCatalog([{ id: 'meteor', nameKey: 'skill.meteor.name' }]);
    const skills = createCharacterSkills(
      { owned: [own('meteor')], loadout: [id('meteor')] },
      catalog,
    );
    expect(ids(skills.loadout)).toEqual(['meteor']);
    expectCode(
      () => createCharacterSkills({ owned: [own('fireball')], loadout: [] }, catalog),
      'UNKNOWN_SKILL_DEFINITION',
    );
  });

  it('is deterministic: equal input gives byte-identical output', () => {
    const input = {
      owned: [own('shield', 2), own('execute', 3)],
      loadout: [id('shield'), id('execute')],
    };
    expect(JSON.stringify(createCharacterSkills(input))).toBe(
      JSON.stringify(createCharacterSkills(input)),
    );
    expect(JSON.stringify(createCharacterSkills(input))).toBe(
      '{"owned":[{"id":"execute","level":3},{"id":"shield","level":2}],' +
        '"loadout":[{"id":"shield","level":2},{"id":"execute","level":3}]}',
    );
  });
});

describe('replaceSkillLoadout', () => {
  const current = createCharacterSkills({
    owned: [own('fireball', 1), own('execute', 3), own('shield', 2), own('whirlwind', 4)],
    loadout: [id('execute'), id('fireball'), id('shield')],
  });

  it('replaces the whole loadout and keeps ownership and levels', () => {
    const next = replaceSkillLoadout(current, [id('whirlwind'), id('fireball')]);
    expect(ids(next.loadout)).toEqual(['whirlwind', 'fireball']);
    expect(next.loadout.map((skill) => skill.level.toNumber())).toEqual([4, 1]);
    expect(next.owned).toEqual(current.owned);
    expect(ids(current.loadout)).toEqual(['execute', 'fireball', 'shield']);
  });

  it('can empty the loadout', () => {
    expect(replaceSkillLoadout(current, []).loadout).toEqual([]);
  });

  it('applies the same validation as creation', () => {
    expectCode(() => replaceSkillLoadout(current, [id('blood_strike')]), 'SKILL_NOT_OWNED');
    expectCode(
      () => replaceSkillLoadout(current, [id('execute'), id('execute')]),
      'DUPLICATE_SKILL',
    );
  });
});

describe('sameSkillLoadout', () => {
  const skills = createCharacterSkills({
    owned: [own('fireball'), own('execute'), own('shield')],
    loadout: [],
  });
  const loadout = (...values: string[]) => replaceSkillLoadout(skills, values.map(id)).loadout;

  it('is true only for the same skills in the same priority order', () => {
    expect(sameSkillLoadout(loadout(), loadout())).toBe(true);
    expect(sameSkillLoadout(loadout('execute', 'fireball'), loadout('execute', 'fireball'))).toBe(
      true,
    );
    expect(sameSkillLoadout(loadout('execute', 'fireball'), loadout('fireball', 'execute'))).toBe(
      false,
    );
    expect(sameSkillLoadout(loadout('execute'), loadout('execute', 'fireball'))).toBe(false);
    expect(sameSkillLoadout(loadout('execute', 'fireball'), loadout('execute'))).toBe(false);
  });
});

describe('SkillDefinitionId.isCanonical', () => {
  it('agrees with parse', () => {
    for (const value of [
      'fireball',
      'blood_strike',
      'Fireball',
      'blood-strike',
      '',
      'a'.repeat(65),
    ]) {
      let parses = true;
      try {
        SkillDefinitionId.parse(value);
      } catch {
        parses = false;
      }
      expect(SkillDefinitionId.isCanonical(value)).toBe(parses);
    }
  });
});
