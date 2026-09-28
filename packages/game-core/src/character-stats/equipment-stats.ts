import { GameCoreError } from '../errors.js';
import { getItemStatModifiers } from '../items/item-affixes.js';
import type { ItemInstance } from '../items/item-instance.js';
import type { CombatStats } from '../stats/combat-stats.js';
import type { BaseCharacterStats, ResolvedCharacterStats } from './character-stats.js';
import { resolveCharacterStats } from './resolve-character-stats.js';

/**
 * Resolves the persisted rolls of authoritative equipped instances. Inventory
 * is deliberately not an input. Duplicate identities are rejected rather than
 * silently granting an item twice when a persistence join is malformed.
 */
export function resolveEquippedCharacterStats(input: {
  readonly baseStats: BaseCharacterStats;
  readonly equippedItems: readonly ItemInstance[];
}): ResolvedCharacterStats {
  const seen = new Set<string>();
  const modifiers = input.equippedItems.flatMap((item) => {
    const id = item.id.toString();
    if (seen.has(id)) {
      throw new GameCoreError('INVALID_ARGUMENT', `Equipped item ${id} appears more than once.`);
    }
    seen.add(id);
    return getItemStatModifiers(item);
  });
  return resolveCharacterStats(input.baseStats, modifiers);
}

/**
 * The single CharacterStats -> CombatStats naming boundary.
 *
 * HugeNumber health/damage remain immutable and lossless. Rate values stay as
 * integer basis points: attack speed 10,000 means one attack/second, critical
 * chance 10,000 means certainty, and critical damage 15,000 means 150% total
 * hit damage. Character resolution already applies minima and the 10,000 crit
 * chance clamp; simulateCombat applies the versioned attack-speed cap.
 */
export function toCombatStats(stats: ResolvedCharacterStats): CombatStats {
  return Object.freeze({
    maxHealth: stats.maxHealth,
    damage: stats.damage,
    attackSpeedBp: stats.attackSpeedBp,
    critChanceBp: stats.criticalChanceBp,
    critDamageBp: stats.criticalDamageBp,
  });
}
