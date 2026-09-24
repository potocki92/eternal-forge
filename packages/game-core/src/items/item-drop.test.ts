import { describe, expect, it } from 'vitest';
import { StageNumber } from '../stage/index.js';
import { ITEM_DROP_RULES_V2 } from '../rules/index.js';
import { ITEM_CATALOG } from './item-catalog.js';
import { resolveItemDrop, selectItemRarity } from './item-drop.js';

const stage = StageNumber.FIRST;

describe('resolveItemDrop — rules v2 golden vectors', () => {
  it.each([
    ['loot-0', null, null],
    ['loot-25', 'ashsteel_cuirass', 'COMMON'],
    ['loot-4', 'forgeheart_amulet', 'MAGIC'],
    ['loot-8', 'runed_iron_ring', 'RARE'],
    ['loot-58', 'smiths_gauntlets', 'EPIC'],
    ['loot-570', 'emberguard_helm', 'LEGENDARY'],
    ['loot-5913', 'smiths_gauntlets', 'MYTHIC'],
  ] as const)('%s resolves to its committed vector', (combatSeed, definitionId, rarity) => {
    const drop = resolveItemDrop({ combatSeed, rulesVersion: 2, stage, outcome: 'WIN' });
    expect(drop?.definitionId.toString() ?? null).toBe(definitionId);
    expect(drop?.rarity ?? null).toBe(rarity);
  });

  it('is repeatable, returns catalog definitions, and does not mutate input', () => {
    const input = Object.freeze({
      combatSeed: 'loot-25',
      rulesVersion: 2,
      stage,
      outcome: 'WIN' as const,
    });
    const first = resolveItemDrop(input);
    const second = resolveItemDrop(input);
    expect(second).toEqual(first);
    expect(first === null ? null : ITEM_CATALOG.require(first.definitionId)).toBeDefined();
    expect(Object.isFrozen(input)).toBe(true);
  });

  it('never drops for a loss or for historical rules v1', () => {
    expect(
      resolveItemDrop({ combatSeed: 'loot-25', rulesVersion: 2, stage, outcome: 'LOSS' }),
    ).toBeNull();
    expect(
      resolveItemDrop({ combatSeed: 'loot-25', rulesVersion: 1, stage, outcome: 'WIN' }),
    ).toBeNull();
  });

  it('rejects an unsupported rules version', () => {
    expect(() =>
      resolveItemDrop({ combatSeed: 'loot-25', rulesVersion: 999, stage, outcome: 'WIN' }),
    ).toThrow('not supported');
  });
});

describe('selectItemRarity — exact cumulative boundaries', () => {
  it.each([
    [0, 'COMMON'],
    [6_999, 'COMMON'],
    [7_000, 'MAGIC'],
    [8_999, 'MAGIC'],
    [9_000, 'RARE'],
    [9_699, 'RARE'],
    [9_700, 'EPIC'],
    [9_899, 'EPIC'],
    [9_900, 'LEGENDARY'],
    [9_989, 'LEGENDARY'],
    [9_990, 'MYTHIC'],
    [9_999, 'MYTHIC'],
  ] as const)('maps draw %i to %s', (draw, rarity) => {
    expect(selectItemRarity(draw, ITEM_DROP_RULES_V2)).toBe(rarity);
  });

  it('uses an auditable 10000-point distribution', () => {
    expect(ITEM_DROP_RULES_V2.rarityWeights.reduce((sum, entry) => sum + entry.weight, 0)).toBe(
      10_000,
    );
    expect(ITEM_DROP_RULES_V2.chanceBasisPoints).toBe(1_000);
    expect(ITEM_DROP_RULES_V2.definitionIds).toHaveLength(7);
    expect(Object.isFrozen(ITEM_DROP_RULES_V2.rarityWeights)).toBe(true);
  });
});
