import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_SLOTS,
  ITEM_CATALOG,
  ITEM_RARITIES,
  RARITY_AFFIX_BUDGET,
  generateItemAffixes,
} from './index.js';

describe('item affix generation v1', () => {
  it.each(ITEM_RARITIES)('%s has its exact rarity budget', (rarity) => {
    for (const definition of ITEM_CATALOG.definitions()) {
      const rolls = generateItemAffixes({ sourceSeed: 'budget-vector', definition, rarity });
      expect(rolls).toHaveLength(RARITY_AFFIX_BUDGET[rarity]);
      expect(new Set(rolls.map((roll) => roll.definitionId)).size).toBe(rolls.length);
      expect(rolls.map((roll) => roll.position)).toEqual(rolls.map((_, index) => index));
    }
  });

  it('has enough eligible immutable catalog entries for every slot', () => {
    expect(new Set(ITEM_CATALOG.definitions().map((definition) => definition.slot))).toEqual(
      new Set(EQUIPMENT_SLOTS),
    );
    for (const definition of ITEM_CATALOG.definitions())
      expect(() =>
        generateItemAffixes({ sourceSeed: 'catalog', definition, rarity: 'MYTHIC' }),
      ).not.toThrow();
  });

  it('is deterministic, isolated, immutable, and preserves its v1 golden vector', () => {
    const definition = ITEM_CATALOG.definitions()[0]!;
    const input = Object.freeze({
      sourceSeed: 'golden-affixes-1',
      definition,
      rarity: 'MYTHIC' as const,
      generationVersion: 1,
    });
    const first = generateItemAffixes(input);
    expect(generateItemAffixes(input)).toEqual(first);
    expect(first).toMatchInlineSnapshot(`
      [
        {
          "definitionId": "damage_percent",
          "operation": "ADDITIVE_PERCENT",
          "position": 0,
          "stat": "DAMAGE",
          "value": "756",
        },
        {
          "definitionId": "attack_speed_percent",
          "operation": "ADDITIVE_PERCENT",
          "position": 1,
          "stat": "ATTACK_SPEED",
          "value": "603",
        },
        {
          "definitionId": "max_health_flat",
          "operation": "FLAT",
          "position": 2,
          "stat": "MAX_HEALTH",
          "value": "5e1",
        },
        {
          "definitionId": "critical_chance_flat",
          "operation": "FLAT",
          "position": 3,
          "stat": "CRITICAL_CHANCE",
          "value": "442",
        },
        {
          "definitionId": "damage_flat",
          "operation": "FLAT",
          "position": 4,
          "stat": "DAMAGE",
          "value": "1.4e1",
        },
      ]
    `);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
