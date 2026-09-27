import { describe, expect, it } from 'vitest';
import { HugeNumber } from '../huge-number/index.js';
import { ITEM_CATALOG } from '../items/item-catalog.js';
import { createItemInstance } from '../items/item-instance.js';
import { ItemDefinitionId, ItemInstanceId } from '../items/item-id.js';
import type { RolledAffix } from '../items/item-affixes.js';
import { deriveBaseCharacterStats } from './character-stats.js';
import { resolveEquippedCharacterStats, toCombatStats } from './equipment-stats.js';
import { getGameRules } from '../rules/index.js';

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
] as const;

function item(id: string, affixes: readonly RolledAffix[] = []) {
  return createItemInstance(
    {
      id: ItemInstanceId.parse(id),
      definitionId: ItemDefinitionId.parse('forged_iron_sword'),
      rarity: affixes.length === 0 ? 'COMMON' : 'MYTHIC',
      generationVersion: affixes.length === 0 ? 0 : 1,
      affixes,
    },
    ITEM_CATALOG,
  );
}

function roll(
  id: string,
  definitionId: string,
  stat: RolledAffix['stat'],
  operation: RolledAffix['operation'],
  value: string,
  position = 0,
): RolledAffix {
  return { id, definitionId, stat, operation, value, position };
}

describe('equipped character stat resolution', () => {
  const base = deriveBaseCharacterStats(1, getGameRules(3));

  it('returns base stats for no equipment and legacy/Common zero-affix items', () => {
    expect(resolveEquippedCharacterStats({ baseStats: base, equippedItems: [] })).toEqual(base);
    expect(
      resolveEquippedCharacterStats({ baseStats: base, equippedItems: [item(IDS[0])] }),
    ).toEqual(base);
  });

  it('aggregates persisted flat, percentage and rate rolls from every equipped item', () => {
    const sword = item(IDS[0], [
      roll('affix-a', 'damage_flat', 'DAMAGE', 'FLAT', '2e1'),
      roll('affix-b', 'damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '500', 1),
      roll('affix-c', 'attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '500', 2),
    ]);
    const ring = item(IDS[1], [
      roll('affix-d', 'max_health_flat', 'MAX_HEALTH', 'FLAT', '5e1'),
      roll('affix-e', 'max_health_percent', 'MAX_HEALTH', 'ADDITIVE_PERCENT', '1000', 1),
      roll('affix-f', 'critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', '500', 2),
      roll('affix-g', 'critical_damage_percent', 'CRITICAL_DAMAGE', 'ADDITIVE_PERCENT', '1000', 3),
    ]);
    const result = resolveEquippedCharacterStats({ baseStats: base, equippedItems: [sword, ring] });
    expect(result.damage.toString()).toBe('3.15e1');
    expect(result.maxHealth.toString()).toBe('1.65e2');
    expect(result.attackSpeedBp).toBe(10_500);
    expect(result.criticalChanceBp).toBe(1_000);
    expect(result.criticalDamageBp).toBe(16_500);
  });

  it('is equipment-order independent and rejects a duplicate instance', () => {
    const first = item(IDS[0], [roll('affix-a', 'damage_flat', 'DAMAGE', 'FLAT', '1e1')]);
    const second = item(IDS[1], [roll('affix-b', 'damage_flat', 'DAMAGE', 'FLAT', '2e1')]);
    const third = item(IDS[2], [
      roll('affix-c', 'damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '500'),
    ]);
    expect(
      resolveEquippedCharacterStats({ baseStats: base, equippedItems: [first, second, third] }),
    ).toEqual(
      resolveEquippedCharacterStats({ baseStats: base, equippedItems: [third, first, second] }),
    );
    expect(() =>
      resolveEquippedCharacterStats({ baseStats: base, equippedItems: [first, first] }),
    ).toThrow(/appears more than once/u);
  });

  it('preserves HugeNumber precision through resolution and the combat adapter', () => {
    const hugeBase = { ...base, damage: HugeNumber.parse('1e5000') };
    const powered = item(IDS[0], [
      roll('affix-a', 'damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '500'),
    ]);
    const combat = toCombatStats(
      resolveEquippedCharacterStats({ baseStats: hugeBase, equippedItems: [powered] }),
    );
    expect(combat.damage.toString()).toBe('1.05e5000');
    expect(combat.critChanceBp).toBe(base.criticalChanceBp);
    expect(combat.critDamageBp).toBe(base.criticalDamageBp);
  });

  it('uses 10,000 bp as one attack/second and total critical multiplier semantics', () => {
    const combat = toCombatStats(base);
    expect(combat.attackSpeedBp).toBe(10_000);
    expect(combat.critChanceBp).toBe(500);
    expect(combat.critDamageBp).toBe(15_000);
  });
});
