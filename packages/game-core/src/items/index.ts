export { EQUIPMENT_SLOTS, parseEquipmentSlot } from './equipment-slot.js';
export type { EquipmentSlot } from './equipment-slot.js';
export {
  ITEM_RARITIES,
  compareItemRarity,
  itemRarityRank,
  parseItemRarity,
} from './item-rarity.js';
export type { ItemRarity } from './item-rarity.js';
export { ITEM_DEFINITION_ID_MAX_LENGTH, ItemDefinitionId, ItemInstanceId } from './item-id.js';
export { createItemDefinition } from './item-definition.js';
export type { ItemDefinition, ItemDefinitionInput } from './item-definition.js';
export { ITEM_CATALOG, ItemCatalog } from './item-catalog.js';
export { ITEM_DROP_SEED_LABEL, resolveItemDrop, selectItemRarity } from './item-drop.js';
export type { ItemDrop, ResolveItemDropInput } from './item-drop.js';
export {
  createItemInstance,
  itemDefinitionFor,
  parseItemInstance,
  serializeItemInstance,
} from './item-instance.js';
export type {
  CreateItemInstanceInput,
  ItemInstance,
  SerializedItemInstance,
} from './item-instance.js';

export {
  AFFIX_CATALOG,
  ITEM_AFFIX_SEED_LABEL,
  ITEM_GENERATION_VERSION,
  LEGACY_ITEM_GENERATION_VERSION,
  RARITY_AFFIX_BUDGET,
  generateItemAffixes,
  getItemStatModifiers,
  parseRolledAffix,
  validateRolledAffix,
} from './item-affixes.js';
export type {
  AffixDefinition,
  AffixValueKind,
  GeneratedAffix,
  RolledAffix,
} from './item-affixes.js';
