import { describe, expect, it } from 'vitest';
import { createCharacter } from '../character/character.js';
import { simulateCombat } from '../combat/index.js';
import { createEnemyForStage } from '../enemy/enemy.js';
import { HugeNumber } from '../huge-number/index.js';
import type { RolledAffix } from '../items/item-affixes.js';
import { ITEM_CATALOG } from '../items/item-catalog.js';
import { ItemDefinitionId, ItemInstanceId } from '../items/item-id.js';
import { createItemInstance, type ItemInstance } from '../items/item-instance.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { getGameRules } from '../rules/index.js';
import { StageNumber } from '../stage/index.js';
import {
  changedCharacterStats,
  describeCharacterStats,
  diffCharacterStats,
  equippedItemsOf,
  previewEquipmentChange,
  resolvePlayerCombatStats,
  type EquipmentLoadout,
} from './character-sheet.js';
import { deriveBaseCharacterStats } from './character-stats.js';
import { resolveEquippedCharacterStats, toCombatStats } from './equipment-stats.js';

const rules = getGameRules(GAME_RULES_VERSION);
let nextId = 0;

function uuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

function roll(
  definitionId: string,
  stat: RolledAffix['stat'],
  operation: RolledAffix['operation'],
  value: string,
  position = 0,
): RolledAffix {
  return { id: `roll-${uuid()}`, definitionId, stat, operation, value, position };
}

function item(definitionId: string, affixes: readonly RolledAffix[] = []): ItemInstance {
  return createItemInstance(
    {
      id: ItemInstanceId.parse(uuid()),
      definitionId: ItemDefinitionId.parse(definitionId),
      rarity: affixes.length === 0 ? 'COMMON' : 'RARE',
      generationVersion: 1,
      affixes,
    },
    ITEM_CATALOG,
  );
}

const EMPTY: EquipmentLoadout = Object.freeze({
  WEAPON: null,
  HELMET: null,
  CHEST: null,
  GLOVES: null,
  BOOTS: null,
  RING: null,
  AMULET: null,
});

const flatDamage = (value: string) => roll('damage_flat', 'DAMAGE', 'FLAT', value);

describe('resolvePlayerCombatStats — the one pipeline combat and the stats query share', () => {
  it('is the level-only baseline without equipment', () => {
    for (const level of [1, 7, 250]) {
      expect(resolvePlayerCombatStats({ level, equippedItems: [], rules })).toEqual(
        createCharacter(level, rules).stats,
      );
    }
  });

  it('equals the base -> equipped modifiers -> combat adapter composition', () => {
    const sword = item('forged_iron_sword', [
      flatDamage('2e1'),
      roll('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '500', 1),
    ]);
    expect(resolvePlayerCombatStats({ level: 12, equippedItems: [sword], rules })).toEqual(
      toCombatStats(
        resolveEquippedCharacterStats({
          baseStats: deriveBaseCharacterStats(12, rules),
          equippedItems: [sword],
        }),
      ),
    );
  });
});

describe('describeCharacterStats', () => {
  it('shows base = effective and a zero bonus with no gear or zero-power gear', () => {
    for (const equippedItems of [[], [item('forged_iron_sword'), item('runed_iron_ring')]]) {
      const sheet = describeCharacterStats({ level: 3, equippedItems, rules });
      expect(sheet.effective).toEqual(sheet.base);
      expect(changedCharacterStats(sheet.bonus)).toEqual([]);
      expect(sheet.atMaximum).toEqual([]);
    }
  });

  it('reports the exact net equipment bonus after flat terms and the percentage pool', () => {
    const sword = item('forged_iron_sword', [
      flatDamage('2e1'),
      roll('damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '500', 1),
    ]);
    const ring = item('runed_iron_ring', [
      roll('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', '300'),
      roll('critical_damage_percent', 'CRITICAL_DAMAGE', 'ADDITIVE_PERCENT', '1000', 1),
    ]);
    const sheet = describeCharacterStats({ level: 1, equippedItems: [sword, ring], rules });

    // (10 + 20) × 1.05 = 31.5; the bonus is that minus the base, not "20 + 5%".
    expect(sheet.base.damage.toString()).toBe('1e1');
    expect(sheet.effective.damage.toString()).toBe('3.15e1');
    expect(sheet.bonus.damage.toString()).toBe('2.15e1');
    expect(sheet.effective.criticalChanceBp).toBe(800);
    expect(sheet.bonus.criticalChanceBp).toBe(300);
    // Critical damage is a total multiplier: 150% × 1.10 = 165%.
    expect(sheet.effective.criticalDamageBp).toBe(16_500);
    expect(sheet.bonus.criticalDamageBp).toBe(1_500);
    expect(changedCharacterStats(sheet.bonus)).toEqual([
      'DAMAGE',
      'CRITICAL_CHANCE',
      'CRITICAL_DAMAGE',
    ]);
  });

  it('shows combat-effective values: the attack-speed cap applies, and it is flagged', () => {
    const blade = item('forged_iron_sword', [
      roll('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '150000'),
    ]);
    const helm = item('emberguard_helm', [
      roll('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', '20000'),
    ]);
    const source = { level: 1, equippedItems: [blade, helm], rules };
    const sheet = describeCharacterStats(source);

    expect(resolvePlayerCombatStats(source).attackSpeedBp).toBe(160_000);
    expect(sheet.effective.attackSpeedBp).toBe(rules.combat.maxAttackSpeedBp);
    expect(sheet.bonus.attackSpeedBp).toBe(rules.combat.maxAttackSpeedBp - 10_000);
    expect(sheet.effective.criticalChanceBp).toBe(10_000);
    expect(sheet.atMaximum).toEqual(['ATTACK_SPEED', 'CRITICAL_CHANCE']);
  });

  it('fights exactly like the combat snapshot: effective values are what combat uses', () => {
    const blade = item('forged_iron_sword', [
      flatDamage('1.7e1'),
      roll('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '150000', 1),
    ]);
    const source = { level: 5, equippedItems: [blade], rules };
    const enemy = createEnemyForStage(StageNumber.of(12), rules);
    const fight = (stats: ReturnType<typeof resolvePlayerCombatStats>) =>
      simulateCombat({ player: { stats }, enemy, seed: 'sheet', rulesVersion: rules.version });

    expect(fight(toCombatStats(describeCharacterStats(source).effective))).toEqual(
      fight(resolvePlayerCombatStats(source)),
    );
  });

  it('keeps late-game HugeNumber values and their differences exact', () => {
    const sword = item('forged_iron_sword', [flatDamage('2.5e1')]);
    const sheet = describeCharacterStats({ level: 1_000, equippedItems: [sword], rules });

    expect(sheet.base.damage.gt(HugeNumber.parse('1e40'))).toBe(true);
    expect(sheet.effective.damage.eq(sheet.base.damage.add(HugeNumber.parse('2.5e1')))).toBe(true);
    expect(sheet.base.damage.add(sheet.bonus.damage).eq(sheet.effective.damage)).toBe(true);
  });
});

describe('diffCharacterStats', () => {
  it('is signed and exact', () => {
    const base = deriveBaseCharacterStats(1, rules);
    const higher = { ...base, maxHealth: HugeNumber.parse('1.3e2'), attackSpeedBp: 12_500 };
    const down = diffCharacterStats(higher, base);
    expect(down.maxHealth.toString()).toBe('-3e1');
    expect(down.attackSpeedBp).toBe(-2_500);
    expect(changedCharacterStats(down)).toEqual(['MAX_HEALTH', 'ATTACK_SPEED']);
    expect(changedCharacterStats(diffCharacterStats(base, base))).toEqual([]);
  });
});

describe('previewEquipmentChange', () => {
  const preview = (
    loadout: EquipmentLoadout,
    change: Parameters<typeof previewEquipmentChange>[0]['change'],
  ) => previewEquipmentChange({ level: 1, loadout, change, rules });

  it('equips into an empty slot and derives the slot from the catalog', () => {
    const ring = item('runed_iron_ring', [flatDamage('1.2e1')]);
    const result = preview(EMPTY, { kind: 'EQUIP', item: ring });

    expect(result.slot).toBe('RING');
    expect(result.displaced).toBeNull();
    expect(result.unchanged).toBe(false);
    expect(result.current.effective.damage.toString()).toBe('1e1');
    expect(result.preview.effective.damage.toString()).toBe('2.2e1');
    expect(result.delta.damage.toString()).toBe('1.2e1');
    expect(changedCharacterStats(result.delta)).toEqual(['DAMAGE']);
  });

  it('replaces the slot: the candidate never stacks with the item it replaces', () => {
    const swordA = item('forged_iron_sword', [flatDamage('1e1')]);
    const swordB = item('forged_iron_sword', [flatDamage('2e1')]);
    const loadout = { ...EMPTY, WEAPON: swordA };
    const result = preview(loadout, { kind: 'EQUIP', item: swordB });

    expect(result.displaced?.id.equals(swordA.id)).toBe(true);
    expect(result.current.effective.damage.toString()).toBe('2e1');
    expect(result.preview.effective.damage.toString()).toBe('3e1');
    expect(result.delta.damage.toString()).toBe('1e1');
    // The preview is what the loadout would actually resolve to after the equip.
    expect(result.preview).toEqual(
      describeCharacterStats({ level: 1, equippedItems: [swordB], rules }),
    );
    expect(loadout.WEAPON).toBe(swordA);
  });

  it('shows a real loss when the candidate is weaker in another stat', () => {
    const tank = item('ashsteel_cuirass', [roll('max_health_flat', 'MAX_HEALTH', 'FLAT', '8e1')]);
    const glass = item('ashsteel_cuirass', [
      roll('damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '900'),
    ]);
    const result = preview({ ...EMPTY, CHEST: tank }, { kind: 'EQUIP', item: glass });
    expect(result.delta.maxHealth.toString()).toBe('-8e1');
    expect(result.delta.damage.toString()).toBe('9e-1');
    expect(changedCharacterStats(result.delta)).toEqual(['MAX_HEALTH', 'DAMAGE']);
  });

  it('is unchanged, with a zero delta, for an item that is already equipped', () => {
    const sword = item('forged_iron_sword', [flatDamage('2e1')]);
    const result = preview({ ...EMPTY, WEAPON: sword }, { kind: 'EQUIP', item: sword });
    expect(result.unchanged).toBe(true);
    expect(result.displaced).toBeNull();
    expect(result.preview).toBe(result.current);
    expect(changedCharacterStats(result.delta)).toEqual([]);
  });

  it('gives Common and legacy zero-affix candidates no effective change', () => {
    const common = item('emberguard_helm');
    const legacy = createItemInstance(
      {
        id: ItemInstanceId.parse(uuid()),
        definitionId: ItemDefinitionId.parse('emberguard_helm'),
        rarity: 'EPIC',
      },
      ITEM_CATALOG,
    );
    for (const candidate of [common, legacy]) {
      const result = preview(EMPTY, { kind: 'EQUIP', item: candidate });
      expect(result.unchanged).toBe(false);
      expect(changedCharacterStats(result.delta)).toEqual([]);
    }
  });

  it('shows the actual capped result: extra Critical Chance at the maximum changes nothing', () => {
    const helm = item('emberguard_helm', [
      roll('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', '9500'),
    ]);
    const ring = item('runed_iron_ring', [
      roll('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', '400'),
      roll('damage_flat', 'DAMAGE', 'FLAT', '1e1', 1),
    ]);
    const result = preview({ ...EMPTY, HELMET: helm }, { kind: 'EQUIP', item: ring });

    expect(result.current.effective.criticalChanceBp).toBe(10_000);
    expect(result.preview.effective.criticalChanceBp).toBe(10_000);
    expect(result.delta.criticalChanceBp).toBe(0);
    expect(result.preview.atMaximum).toContain('CRITICAL_CHANCE');
    expect(changedCharacterStats(result.delta)).toEqual(['DAMAGE']);
  });

  it('shows a partial gain when a candidate crosses the attack-speed cap', () => {
    const boots = item('cinderwalk_boots', [
      roll('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '85000'),
    ]);
    const gloves = item('smiths_gauntlets', [
      roll('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', '10000'),
    ]);
    const result = preview({ ...EMPTY, BOOTS: boots }, { kind: 'EQUIP', item: gloves });
    // 95,000 → capped at 100,000: +5,000, not the +10,000 the affix text suggests.
    expect(result.current.effective.attackSpeedBp).toBe(95_000);
    expect(result.preview.effective.attackSpeedBp).toBe(100_000);
    expect(result.delta.attackSpeedBp).toBe(5_000);
  });

  it('previews an unequip as the loadout without that item, and an empty slot as unchanged', () => {
    const amulet = item('forgeheart_amulet', [
      roll('max_health_percent', 'MAX_HEALTH', 'ADDITIVE_PERCENT', '500'),
    ]);
    const removed = preview({ ...EMPTY, AMULET: amulet }, { kind: 'UNEQUIP', slot: 'AMULET' });
    expect(removed.item).toBeNull();
    expect(removed.displaced?.id.equals(amulet.id)).toBe(true);
    expect(removed.delta.maxHealth.toString()).toBe('-5e0');
    expect(removed.preview).toEqual(describeCharacterStats({ level: 1, equippedItems: [], rules }));

    const empty = preview(EMPTY, { kind: 'UNEQUIP', slot: 'AMULET' });
    expect(empty.unchanged).toBe(true);
    expect(changedCharacterStats(empty.delta)).toEqual([]);
  });

  it('rejects an incoherent loadout rather than resolving it', () => {
    const sword = item('forged_iron_sword', [flatDamage('1e1')]);
    expect(() => preview({ ...EMPTY, RING: sword }, { kind: 'UNEQUIP', slot: 'RING' })).toThrow(
      /does not belong in the RING slot/u,
    );
  });

  it('lists equipped items in canonical slot order', () => {
    const ring = item('runed_iron_ring');
    const sword = item('forged_iron_sword');
    expect(equippedItemsOf({ ...EMPTY, RING: ring, WEAPON: sword })).toEqual([sword, ring]);
  });
});
