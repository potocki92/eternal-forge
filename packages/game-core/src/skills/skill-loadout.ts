import { GameCoreError } from '../errors.js';
import { SKILL_CATALOG, type SkillCatalog } from './skill-catalog.js';
import type { SkillDefinitionId } from './skill-definition-id.js';
import type { SkillLevel } from './skill-level.js';

/**
 * Most active skills one character can have in its loadout (ADR-032).
 *
 * A Phase 7 product decision, not balance: four leaves room for a meaningful
 * priority order while keeping unequipped skills relevant as the catalog
 * grows, bounds the PR 7.3 scheduler, and fits one row of controls on a
 * phone. It is the only place the number exists; the API reports it to
 * clients (`maxLoadoutSize`) and the database stores positions without
 * repeating it.
 */
export const SKILL_LOADOUT_MAX_SIZE = 4;

/** A skill a character owns, at its persisted level. Unowned skills are absent. */
export interface OwnedSkill {
  readonly id: SkillDefinitionId;
  readonly level: SkillLevel;
}

/**
 * A character's authoritative skill source state (ADR-032).
 *
 * - `owned` — every owned skill, in catalog declaration order. That order is
 *   presentation only.
 * - `loadout` — the equipped skills in **priority order**: index 0 is the
 *   highest priority, the order PR 7.1's `selectSkillActivation` consumes.
 *   Each entry is one of `owned`, so it carries that skill's level.
 *
 * Only source state: no resolved skill, cooldown or parameter is stored or
 * derived here. Frozen.
 */
export interface CharacterSkills {
  readonly owned: readonly OwnedSkill[];
  readonly loadout: readonly OwnedSkill[];
}

export interface CharacterSkillsInput {
  readonly owned: readonly OwnedSkill[];
  /** Skill identities in priority order, highest first. */
  readonly loadout: readonly SkillDefinitionId[];
}

/**
 * Validates and canonicalises a character's skill state.
 *
 * Checks, in this order, so the reported reason is deterministic:
 *
 * 1. every owned skill is in the catalog (`UNKNOWN_SKILL_DEFINITION`) and
 *    owned once (`DUPLICATE_SKILL`);
 * 2. the loadout has at most {@link SKILL_LOADOUT_MAX_SIZE} entries
 *    (`SKILL_LOADOUT_TOO_LARGE`);
 * 3. no skill appears twice in it (`DUPLICATE_SKILL`);
 * 4. every entry is in the catalog (`UNKNOWN_SKILL_DEFINITION`);
 * 5. every entry is owned (`SKILL_NOT_OWNED`).
 *
 * Nothing is dropped or reordered silently: an invalid state is refused.
 * An empty loadout is valid, with or without owned skills.
 */
export function createCharacterSkills(
  input: CharacterSkillsInput,
  catalog: SkillCatalog = SKILL_CATALOG,
): CharacterSkills {
  const ownedById = new Map<string, OwnedSkill>();
  for (const skill of input.owned) {
    catalog.require(skill.id);
    const key = skill.id.toString();
    if (ownedById.has(key)) {
      throw new GameCoreError('DUPLICATE_SKILL', `Skill "${key}" is owned more than once.`);
    }
    ownedById.set(key, Object.freeze({ id: skill.id, level: skill.level }));
  }
  const owned = catalog
    .definitions()
    .flatMap((definition) => ownedById.get(definition.id.toString()) ?? []);

  return Object.freeze({
    owned: Object.freeze(owned),
    loadout: Object.freeze(validateLoadout(input.loadout, ownedById, catalog)),
  });
}

/**
 * The state after replacing the whole loadout with `loadout` (set semantics,
 * ADR-032): ownership and levels are unchanged, the new order is the new
 * priority. Validated exactly like {@link createCharacterSkills}.
 */
export function replaceSkillLoadout(
  skills: CharacterSkills,
  loadout: readonly SkillDefinitionId[],
  catalog: SkillCatalog = SKILL_CATALOG,
): CharacterSkills {
  return createCharacterSkills({ owned: skills.owned, loadout }, catalog);
}

/** Whether two loadouts equip the same skills in the same priority order. */
export function sameSkillLoadout(
  left: readonly OwnedSkill[],
  right: readonly OwnedSkill[],
): boolean {
  return (
    left.length === right.length &&
    left.every((skill, index) => right[index]?.id.equals(skill.id) === true)
  );
}

function validateLoadout(
  loadout: readonly SkillDefinitionId[],
  ownedById: ReadonlyMap<string, OwnedSkill>,
  catalog: SkillCatalog,
): OwnedSkill[] {
  if (loadout.length > SKILL_LOADOUT_MAX_SIZE) {
    throw new GameCoreError(
      'SKILL_LOADOUT_TOO_LARGE',
      `A skill loadout holds at most ${String(SKILL_LOADOUT_MAX_SIZE)} skills.`,
    );
  }
  const seen = new Set<string>();
  for (const id of loadout) {
    const key = id.toString();
    if (seen.has(key)) {
      throw new GameCoreError('DUPLICATE_SKILL', `Skill "${key}" appears twice in the loadout.`);
    }
    seen.add(key);
  }
  for (const id of loadout) catalog.require(id);
  return loadout.map((id) => {
    const skill = ownedById.get(id.toString());
    if (skill === undefined) {
      throw new GameCoreError('SKILL_NOT_OWNED', `Skill "${id.toString()}" is not owned.`);
    }
    return skill;
  });
}
