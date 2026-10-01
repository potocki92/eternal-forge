import {
  SKILL_LEVEL_MAX,
  SKILL_LOADOUT_MAX_SIZE,
  SkillDefinitionId,
} from '@eternal-forge/game-core';
import { z } from 'zod';
import { characterVersionSchema } from '../items/inventory.contract.js';

/**
 * Active skill source state on the wire (ADR-031, ADR-032).
 *
 * The identity format and the loadout size are owned by Game Core. These
 * schemas delegate to `SkillDefinitionId.isCanonical` and read
 * `SKILL_LOADOUT_MAX_SIZE`, so neither rule is written twice — the same edge
 * ADR-013 opened for `HugeNumber`.
 */
export const skillIdSchema = z.string().refine((value) => SkillDefinitionId.isCanonical(value), {
  message: 'Must be a canonical skill ID: lowercase letters, digits and single underscores.',
});
export type SkillIdDto = z.infer<typeof skillIdSchema>;

/** A skill level: a whole number from 1; an unowned skill is absent, never level 0. */
export const skillLevelSchema = z.number().int().min(1).max(SKILL_LEVEL_MAX);

/** One owned skill. Owned skills are listed in catalog order, which is not a priority. */
export const ownedSkillSchema = z.strictObject({
  skillId: skillIdSchema,
  /** Localisation key, `skill.<id>.name`. */
  nameKey: z.string().min(1),
  level: skillLevelSchema,
});
export type OwnedSkillDto = z.infer<typeof ownedSkillSchema>;

/**
 * One equipped skill. `priority` is its index in the loadout: 0 is cast
 * first when several skills are ready (from PR 7.3; skills do not affect
 * combat yet).
 */
export const loadoutSkillSchema = ownedSkillSchema.extend({
  priority: z.number().int().min(0),
});
export type LoadoutSkillDto = z.infer<typeof loadoutSkillSchema>;

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * `GET /player/characters/:characterId/skills` and the loadout command's
 * answer: one coherent snapshot of the character's skills.
 *
 * `characterVersion` names exactly the state returned with it. An empty
 * state (`owned: []`, `loadout: []`) is a normal answer, not an error.
 */
export const skillStateResponseSchema = z
  .strictObject({
    characterVersion: characterVersionSchema,
    /** The most skills a loadout may hold. Clients read it here; they never hard-code it. */
    maxLoadoutSize: z.number().int().min(1),
    owned: z.array(ownedSkillSchema),
    /** Equipped skills in priority order, highest first. */
    loadout: z.array(loadoutSkillSchema),
  })
  .refine((state) => unique(state.owned.map((skill) => skill.skillId)), {
    message: 'A skill is owned at most once.',
    path: ['owned'],
  })
  .refine((state) => state.loadout.length <= state.maxLoadoutSize, {
    message: 'The loadout exceeds its maximum size.',
    path: ['loadout'],
  })
  .refine((state) => state.loadout.every((skill, index) => skill.priority === index), {
    message: 'Loadout priorities must be 0, 1, 2, … in order.',
    path: ['loadout'],
  })
  .refine((state) => unique(state.loadout.map((skill) => skill.skillId)), {
    message: 'A skill is equipped at most once.',
    path: ['loadout'],
  })
  .refine(
    (state) =>
      state.loadout.every((equipped) =>
        state.owned.some(
          (owned) => owned.skillId === equipped.skillId && owned.level === equipped.level,
        ),
      ),
    { message: 'Every equipped skill must be owned, at its owned level.', path: ['loadout'] },
  );
export type SkillStateResponse = z.infer<typeof skillStateResponseSchema>;

/**
 * `PUT /player/characters/:characterId/skills/loadout` — replace the whole
 * loadout (set semantics, ADR-032).
 *
 * The client sends only the identities it wants equipped, in priority order.
 * Levels, positions, ownership and every gameplay value are the server's;
 * any other field is a validation error. Whether each skill is known and
 * owned is decided by the server against persisted state.
 */
export const setSkillLoadoutRequestSchema = z.strictObject({
  skillIds: z
    .array(skillIdSchema)
    .max(SKILL_LOADOUT_MAX_SIZE)
    .refine(unique, { message: 'A skill can be equipped only once.' }),
});
export type SetSkillLoadoutRequest = z.infer<typeof setSkillLoadoutRequestSchema>;
