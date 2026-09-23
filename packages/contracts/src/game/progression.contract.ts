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

/**
 * Where the character stands on the stage ladder (ADR-020). All three are
 * canonical decimal strings, exact to 2^63 − 1 (ADR-018).
 */
export const stageProgressShape = {
  /** The stage the next combat is fought on — the stage being pushed or farmed. */
  currentStage: stageNumberSchema,
  /** The highest stage ever unlocked. Never decreases. */
  highestStageReached: stageNumberSchema,
  /**
   * The highest stage ever defeated, or `null` before the first victory. Never
   * decreases. Progression rankings will use this value.
   */
  highestStageCleared: stageNumberSchema.nullable(),
};

interface StageProgressFields {
  readonly currentStage: string;
  readonly highestStageReached: string;
  readonly highestStageCleared: string | null;
}

/** `current ≤ highestReached` and `highestCleared ≤ highestReached`, compared exactly. */
export function stageProgressIsConsistent(value: StageProgressFields): boolean {
  const reached = BigInt(value.highestStageReached);
  return (
    BigInt(value.currentStage) <= reached &&
    (value.highestStageCleared === null || BigInt(value.highestStageCleared) <= reached)
  );
}

export const STAGE_PROGRESS_INVARIANT_MESSAGE =
  'currentStage and highestStageCleared must not exceed highestStageReached';

export const stageProgressSchema = z
  .object(stageProgressShape)
  .refine(stageProgressIsConsistent, { message: STAGE_PROGRESS_INVARIANT_MESSAGE });
export type StageProgressDto = z.infer<typeof stageProgressSchema>;

export const progressionSchema = z
  .object({
    ...stageProgressShape,
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
  })
  .refine(stageProgressIsConsistent, { message: STAGE_PROGRESS_INVARIANT_MESSAGE });
export type ProgressionDto = z.infer<typeof progressionSchema>;
