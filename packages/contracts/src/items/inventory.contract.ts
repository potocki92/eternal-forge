import { z } from 'zod';

export const equipmentSlotSchema = z.enum([
  'WEAPON',
  'HELMET',
  'CHEST',
  'GLOVES',
  'BOOTS',
  'RING',
  'AMULET',
]);
export const itemRaritySchema = z.enum(['COMMON', 'MAGIC', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']);
export const itemDefinitionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  .max(64);
export const itemAffixSchema = z.strictObject({
  id: z.uuid(),
  definitionId: itemDefinitionIdSchema,
  stat: z.enum(['MAX_HEALTH', 'DAMAGE', 'ATTACK_SPEED', 'CRITICAL_CHANCE', 'CRITICAL_DAMAGE']),
  operation: z.enum(['FLAT', 'ADDITIVE_PERCENT']),
  value: z.string().min(1).max(64),
  position: z.number().int().nonnegative(),
});
export const itemInstanceSchema = z.strictObject({
  id: z.uuid(),
  definitionId: itemDefinitionIdSchema,
  rarity: itemRaritySchema,
  generationVersion: z.number().int().nonnegative().default(0),
  affixes: z.array(itemAffixSchema).default([]),
  nameKey: z.string().min(1),
  slot: equipmentSlotSchema,
  createdAt: z.iso.datetime(),
});
export const inventoryResponseSchema = z.strictObject({ ownedItems: z.array(itemInstanceSchema) });
export const equipmentSchema = z.strictObject({
  WEAPON: itemInstanceSchema.nullable(),
  HELMET: itemInstanceSchema.nullable(),
  CHEST: itemInstanceSchema.nullable(),
  GLOVES: itemInstanceSchema.nullable(),
  BOOTS: itemInstanceSchema.nullable(),
  RING: itemInstanceSchema.nullable(),
  AMULET: itemInstanceSchema.nullable(),
});
export const equipmentResponseSchema = z.strictObject({
  equipment: equipmentSchema,
  characterVersion: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
});
export const equipItemRequestSchema = z.strictObject({ itemInstanceId: z.uuid() });
export const unequipItemRequestSchema = z.strictObject({ slot: equipmentSlotSchema });
export type EquipmentSlotDto = z.infer<typeof equipmentSlotSchema>;
export type ItemRarityDto = z.infer<typeof itemRaritySchema>;
export type ItemInstanceDto = z.infer<typeof itemInstanceSchema>;
export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;
export type EquipmentResponse = z.infer<typeof equipmentResponseSchema>;
export type EquipItemRequest = z.infer<typeof equipItemRequestSchema>;
export type UnequipItemRequest = z.infer<typeof unequipItemRequestSchema>;
