import { z } from 'zod';
import { hugeAmountSchema, hugeNumberSchema } from '../huge-number/huge-number.contract.js';
import {
  characterVersionSchema,
  equipmentSlotSchema,
  itemAffixSchema,
  itemDefinitionIdSchema,
  itemInstanceSchema,
  itemRaritySchema,
} from '../items/inventory.contract.js';

/**
 * Character stats as the server resolves them (ADR-027, ADR-029, ADR-030).
 *
 * Every value here is derived by Game Core on the server from persisted
 * source state — level and equipped item rolls. The client formats them; it
 * never computes a stat, a delta or a cap. Health and damage are canonical
 * HugeNumber strings; rates are integer basis points (10,000 = 100%, and for
 * attack speed 10,000 = one attack per second).
 */
export const characterStatIdSchema = z.enum([
  'MAX_HEALTH',
  'DAMAGE',
  'ATTACK_SPEED',
  'CRITICAL_CHANCE',
  'CRITICAL_DAMAGE',
]);
export type CharacterStatIdDto = z.infer<typeof characterStatIdSchema>;

/** One complete, legal set of stat values. */
export const characterStatValuesSchema = z.strictObject({
  maxHealth: hugeAmountSchema.refine((value) => value !== '0', 'Max Health must be positive.'),
  damage: hugeAmountSchema,
  /** Attacks per second in basis points: 12,500 = 1.25 attacks per second. */
  attackSpeedBp: z.number().int().min(1),
  /** Probability in basis points: 1,435 = 14.35%. */
  criticalChanceBp: z.number().int().min(0).max(10_000),
  /** Total critical-hit multiplier, not a bonus: 15,000 = 150% of a normal hit. */
  criticalDamageBp: z.number().int().min(10_000),
});
export type CharacterStatValuesDto = z.infer<typeof characterStatValuesSchema>;

/** A signed per-stat difference; health and damage are signed HugeNumber strings. */
export const characterStatDeltaSchema = z.strictObject({
  maxHealth: hugeNumberSchema,
  damage: hugeNumberSchema,
  attackSpeedBp: z.number().int(),
  criticalChanceBp: z.number().int().min(-10_000).max(10_000),
  criticalDamageBp: z.number().int(),
});
export type CharacterStatDeltaDto = z.infer<typeof characterStatDeltaSchema>;

/**
 * `effective` is what combat fights with: resolved equipment, then the rule
 * set's combat caps. `bonus` is exactly `effective − base`, the net effect of
 * all equipped items after the percentage pool, rounding and caps.
 */
export const characterStatSheetSchema = z.strictObject({
  base: characterStatValuesSchema,
  bonus: characterStatDeltaSchema,
  effective: characterStatValuesSchema,
  /** Stats whose effective value is at a hard maximum; more of them has no effect. */
  atMaximum: z.array(characterStatIdSchema).max(5),
});
export type CharacterStatSheetDto = z.infer<typeof characterStatSheetSchema>;

/**
 * One persisted affix roll of an equipped item, as the resolver consumed it.
 * These are inputs, not contributions: percentage rolls pool before they
 * multiply, so they do not add up to `bonus` on their own.
 */
export const characterStatSourceSchema = z.strictObject({
  stat: characterStatIdSchema,
  operation: itemAffixSchema.shape.operation,
  value: itemAffixSchema.shape.value,
  slot: equipmentSlotSchema,
  itemDefinitionId: itemDefinitionIdSchema,
  itemNameKey: z.string().min(1),
  itemRarity: itemRaritySchema,
});
export type CharacterStatSourceDto = z.infer<typeof characterStatSourceSchema>;

/** `GET /player/characters/:characterId/stats` */
export const characterStatsResponseSchema = z.strictObject({
  level: z.number().int().min(1),
  /** The version the stats were read at; any character write moves it on. */
  characterVersion: characterVersionSchema,
  /** The rule set the stats were resolved under — the one new combats use. */
  rulesVersion: z.number().int().min(1),
  stats: characterStatSheetSchema,
  sources: z.array(characterStatSourceSchema).max(64),
});
export type CharacterStatsResponse = z.infer<typeof characterStatsResponseSchema>;

/**
 * `GET /player/characters/:characterId/stats/preview?equip=<itemInstanceId>`
 * or `?unequip=<SLOT>`. The client states only the intent, exactly as the two
 * equipment commands accept it; the server derives the slot, the replaced
 * item and every stat.
 */
export const statsPreviewQuerySchema = z.union([
  // Item instance IDs are canonical lowercase UUIDs (ADR-024); an uppercase
  // spelling is refused here rather than failing deeper in the domain.
  z.strictObject({
    equip: z.uuid().regex(/^[0-9a-f-]+$/u, 'Must be a lowercase canonical UUID.'),
  }),
  z.strictObject({ unequip: equipmentSlotSchema }),
]);
export type StatsPreviewQuery = z.infer<typeof statsPreviewQuerySchema>;

export const statsPreviewChangeSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('EQUIP'),
      slot: equipmentSlotSchema,
      /** The candidate. */
      item: itemInstanceSchema,
      /** The item it would replace in that slot, or `null` for an empty slot. */
      replaces: itemInstanceSchema.nullable(),
    }),
    z.strictObject({
      kind: z.literal('UNEQUIP'),
      slot: equipmentSlotSchema,
      /** The item that would be removed, or `null` when the slot is already empty. */
      item: itemInstanceSchema.nullable(),
    }),
  ])
  .refine(
    (change) =>
      (change.item === null || change.item.slot === change.slot) &&
      (change.kind === 'UNEQUIP' ||
        change.replaces === null ||
        change.replaces.slot === change.slot),
    { message: 'Every item in a change must belong to its slot.' },
  );
export type StatsPreviewChangeDto = z.infer<typeof statsPreviewChangeSchema>;

export const statsPreviewResponseSchema = z.strictObject({
  characterVersion: characterVersionSchema,
  rulesVersion: z.number().int().min(1),
  change: statsPreviewChangeSchema,
  /** The change is already in effect: the candidate is worn, or the slot is empty. */
  unchanged: z.boolean(),
  current: characterStatSheetSchema,
  preview: characterStatSheetSchema,
  /** `preview.effective − current.effective`, computed on the server. */
  delta: characterStatDeltaSchema,
});
export type StatsPreviewResponse = z.infer<typeof statsPreviewResponseSchema>;
