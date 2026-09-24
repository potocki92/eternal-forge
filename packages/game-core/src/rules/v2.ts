import { ITEM_CATALOG } from '../items/item-catalog.js';
import { ItemDefinitionId } from '../items/item-id.js';
import type { ItemRarity } from '../items/item-rarity.js';
import type { GameRules } from './game-rules.js';
import { RULES_V1 } from './v1.js';

export interface ItemRarityWeight {
  readonly rarity: ItemRarity;
  readonly weight: number;
}

export interface ItemDropRules {
  /** Chance out of 10,000 for every eligible victory. */
  readonly chanceBasisPoints: number;
  /** Uniform pool. Ordering is a stable part of rules v2. */
  readonly definitionIds: readonly ItemDefinitionId[];
  /** Ordered, explicit weights whose sum is 10,000. */
  readonly rarityWeights: readonly ItemRarityWeight[];
}

/**
 * Rule set 2 adds item rewards without changing rules-v1 combat, progression,
 * gold, XP, boss, or offline balance. Object spreads deliberately retain the
 * exact immutable values used by v1.
 */
export const RULES_V2: GameRules = {
  ...RULES_V1,
  version: 2,
};

const RARITY_WEIGHTS: readonly ItemRarityWeight[] = Object.freeze([
  Object.freeze({ rarity: 'COMMON', weight: 7_000 }),
  Object.freeze({ rarity: 'MAGIC', weight: 2_000 }),
  Object.freeze({ rarity: 'RARE', weight: 700 }),
  Object.freeze({ rarity: 'EPIC', weight: 200 }),
  Object.freeze({ rarity: 'LEGENDARY', weight: 90 }),
  Object.freeze({ rarity: 'MYTHIC', weight: 10 }),
]);

const lootDefinition = (value: string): ItemDefinitionId => {
  const id = ItemDefinitionId.parse(value);
  ITEM_CATALOG.require(id);
  return id;
};

const LOOT_DEFINITION_IDS = Object.freeze([
  lootDefinition('forged_iron_sword'),
  lootDefinition('emberguard_helm'),
  lootDefinition('ashsteel_cuirass'),
  lootDefinition('smiths_gauntlets'),
  lootDefinition('cinderwalk_boots'),
  lootDefinition('runed_iron_ring'),
  lootDefinition('forgeheart_amulet'),
]);

export const ITEM_DROP_RULES_V2: ItemDropRules = Object.freeze({
  chanceBasisPoints: 1_000,
  definitionIds: LOOT_DEFINITION_IDS,
  rarityWeights: RARITY_WEIGHTS,
});
