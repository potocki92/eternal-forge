import type { CombatOutcome } from '../combat/index.js';
import { createRng, deriveSeed } from '../rng/index.js';
import { ITEM_DROP_RULES_V2, getGameRules, type ItemDropRules } from '../rules/index.js';
import type { StageNumber } from '../stage/index.js';
import type { ItemDefinitionId } from './item-id.js';
import type { ItemRarity } from './item-rarity.js';

export const ITEM_DROP_SEED_LABEL = 'item-drop';

export interface ItemDrop {
  readonly definitionId: ItemDefinitionId;
  readonly rarity: ItemRarity;
}

export interface ResolveItemDropInput {
  /** The authoritative combat seed. A distinct child stream is derived. */
  readonly combatSeed: string;
  readonly rulesVersion: number;
  readonly stage: StageNumber;
  readonly outcome: CombatOutcome;
}

function rulesFor(version: number): ItemDropRules | null {
  getGameRules(version);
  return version === 2 ? ITEM_DROP_RULES_V2 : null;
}

/** Selects from explicit cumulative weights. Exported for threshold tests. */
export function selectItemRarity(draw: number, rules: ItemDropRules): ItemRarity {
  if (!Number.isInteger(draw) || draw < 0 || draw >= 10_000) {
    throw new RangeError('Rarity draw must be an integer in [0, 10000).');
  }
  let cumulative = 0;
  for (const entry of rules.rarityWeights) {
    cumulative += entry.weight;
    if (draw < cumulative) return entry.rarity;
  }
  throw new RangeError('Item rarity weights must total 10000.');
}

/**
 * Resolves optional generation data only; persistent identity belongs to the
 * trusted application boundary. Draw contract: eligibility, then (on success)
 * definition, then rarity. Losses consume no draws and always return null.
 */
export function resolveItemDrop(input: ResolveItemDropInput): ItemDrop | null {
  const rules = rulesFor(input.rulesVersion);
  if (input.outcome !== 'WIN' || rules === null) return null;

  const seed = deriveSeed(
    input.combatSeed,
    ITEM_DROP_SEED_LABEL,
    input.rulesVersion,
    input.stage.toString(),
  );
  const rng = createRng(seed);
  if (!rng.chance(rules.chanceBasisPoints)) return null;

  const definitionId = rules.definitionIds[rng.nextInt(rules.definitionIds.length)];
  if (definitionId === undefined) throw new RangeError('Item drop pool must not be empty.');
  const rarity = selectItemRarity(rng.nextInt(10_000), rules);
  return Object.freeze({ definitionId, rarity });
}
