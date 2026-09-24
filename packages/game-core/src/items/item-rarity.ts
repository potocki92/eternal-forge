import { GameCoreError } from '../errors.js';

/** Canonical persistence/wire values, deliberately separate from their rank. */
export const ITEM_RARITIES = Object.freeze([
  'COMMON',
  'MAGIC',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
] as const);

export type ItemRarity = (typeof ITEM_RARITIES)[number];

const RARITY_RANKS: Readonly<Record<ItemRarity, number>> = Object.freeze({
  COMMON: 0,
  MAGIC: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
  MYTHIC: 5,
});

export function parseItemRarity(value: string): ItemRarity {
  const rarity = ITEM_RARITIES.find((candidate) => candidate === value);
  if (rarity === undefined) {
    throw new GameCoreError('INVALID_FORMAT', `Unknown item rarity: "${value}".`);
  }
  return rarity;
}

export function itemRarityRank(rarity: ItemRarity): number {
  return RARITY_RANKS[rarity];
}

/** Exact total order independent of spelling or enum implementation details. */
export function compareItemRarity(first: ItemRarity, second: ItemRarity): -1 | 0 | 1 {
  const difference = itemRarityRank(first) - itemRarityRank(second);
  return difference === 0 ? 0 : difference < 0 ? -1 : 1;
}
