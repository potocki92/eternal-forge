import { z } from 'zod';
import { hugeAmountSchema } from '../huge-number/huge-number.contract.js';
import { stageNumberSchema } from '../stage/stage-number.contract.js';

/**
 * Values Game Core derives from a character's source state, sent so the
 * client can display them without computing any gameplay rule (ADR-019).
 */

/** Classified by the rule set on the server. Clients never infer it from the number. */
export const stageKindSchema = z.enum(['REGULAR', 'BOSS']);
export type StageKind = z.infer<typeof stageKindSchema>;

export const stageSchema = z.object({
  number: stageNumberSchema,
  kind: stageKindSchema,
});
export type StageDto = z.infer<typeof stageSchema>;

export const enemySchema = z.object({
  /** Content id of the enemy archetype, e.g. `husk`, `warden`. */
  archetypeId: z.string().min(1).max(64),
  maxHealth: hugeAmountSchema,
  damage: hugeAmountSchema,
});
export type EnemyDto = z.infer<typeof enemySchema>;

/** The hero's combat stats, derived from its level. */
export const heroStatsSchema = z.object({
  maxHealth: hugeAmountSchema,
  damage: hugeAmountSchema,
});
export type HeroStatsDto = z.infer<typeof heroStatsSchema>;

export const encounterSchema = z.object({
  stage: stageSchema,
  enemy: enemySchema,
});
export type EncounterDto = z.infer<typeof encounterSchema>;

export const progressionSchema = z.object({
  /** Experience needed to go from the current level to the next. */
  experienceToNextLevel: hugeAmountSchema,
  hero: heroStatsSchema,
  /**
   * The enemy waiting on the character's current stage, or `null` when the
   * stage lies beyond what the rule set can scale. No combat is possible there.
   */
  encounter: encounterSchema.nullable(),
  /**
   * Server time from which the next combat may start. Until then the hero is
   * still fighting the previous one (ADR-019, "Pacing").
   */
  nextCombatAt: z.iso.datetime(),
});
export type ProgressionDto = z.infer<typeof progressionSchema>;
