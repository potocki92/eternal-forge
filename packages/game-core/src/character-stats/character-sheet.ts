import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import { EQUIPMENT_SLOTS, type EquipmentSlot } from '../items/equipment-slot.js';
import { ITEM_CATALOG, type ItemCatalog } from '../items/item-catalog.js';
import type { ItemInstance } from '../items/item-instance.js';
import type { GameRules } from '../rules/index.js';
import { applyCombatCaps, type CombatStats } from '../stats/combat-stats.js';
import {
  CHARACTER_CRITICAL_CHANCE_MAX_BP,
  CHARACTER_STAT_IDS,
  deriveBaseCharacterStats,
  type CharacterStatId,
  type CharacterStats,
} from './character-stats.js';
import { resolveEquippedCharacterStats, toCombatStats } from './equipment-stats.js';

/** Source state that decides a player's power: its level and what it wears. */
export interface PlayerStatSource {
  readonly level: number;
  /** Authoritative equipped instances only. Inventory is never an input. */
  readonly equippedItems: readonly ItemInstance[];
  /** The immutable rule set the stats are resolved under. */
  readonly rules: GameRules;
}

/**
 * Exactly the stats the next online combat receives, and records in its
 * immutable snapshot (ADR-029): level base -> equipped modifiers -> the one
 * CharacterStats -> CombatStats adapter. The combat use case and the
 * character-stats query both call this, so there is one pipeline, not two.
 */
export function resolvePlayerCombatStats(source: PlayerStatSource): CombatStats {
  return toCombatStats(
    resolveEquippedCharacterStats({
      baseStats: deriveBaseCharacterStats(source.level, source.rules),
      equippedItems: source.equippedItems,
    }),
  );
}

/**
 * A signed per-stat difference. Health and damage stay HugeNumber, so a
 * difference is exact at any magnitude; rates are integer basis points.
 */
export interface CharacterStatDelta {
  readonly maxHealth: HugeNumber;
  readonly damage: HugeNumber;
  readonly attackSpeedBp: number;
  readonly criticalChanceBp: number;
  readonly criticalDamageBp: number;
}

/** `to − from` for every stat. */
export function diffCharacterStats(from: CharacterStats, to: CharacterStats): CharacterStatDelta {
  return Object.freeze({
    maxHealth: to.maxHealth.sub(from.maxHealth),
    damage: to.damage.sub(from.damage),
    attackSpeedBp: to.attackSpeedBp - from.attackSpeedBp,
    criticalChanceBp: to.criticalChanceBp - from.criticalChanceBp,
    criticalDamageBp: to.criticalDamageBp - from.criticalDamageBp,
  });
}

/** The stats a delta changes, in canonical stat order. Empty means no effective change. */
export function changedCharacterStats(delta: CharacterStatDelta): readonly CharacterStatId[] {
  const changed: Record<CharacterStatId, boolean> = {
    MAX_HEALTH: !delta.maxHealth.isZero(),
    DAMAGE: !delta.damage.isZero(),
    ATTACK_SPEED: delta.attackSpeedBp !== 0,
    CRITICAL_CHANCE: delta.criticalChanceBp !== 0,
    CRITICAL_DAMAGE: delta.criticalDamageBp !== 0,
  };
  return Object.freeze(CHARACTER_STAT_IDS.filter((stat) => changed[stat]));
}

/**
 * What a character sheet shows, all derived by the same resolver combat uses.
 *
 * `effective` is the combat-effective value: the resolved stats after the
 * rule set's combat caps, i.e. the numbers the combat engine actually fights
 * with. Below every cap it is identical to the combat snapshot. `bonus` is the
 * exact net effect of the equipped items (`effective − base`) after flat
 * terms, the additive percentage pool, half-even rounding, minima and caps —
 * never a sum of affix text.
 */
export interface CharacterStatSheet {
  /** Level-derived stats before any modifier. */
  readonly base: CharacterStats;
  readonly effective: CharacterStats;
  readonly bonus: CharacterStatDelta;
  /** Stats whose effective value sits at a hard maximum: more of them has no effect. */
  readonly atMaximum: readonly CharacterStatId[];
}

function fromCombatStats(stats: CombatStats): CharacterStats {
  return Object.freeze({
    maxHealth: stats.maxHealth,
    damage: stats.damage,
    attackSpeedBp: stats.attackSpeedBp,
    criticalChanceBp: stats.critChanceBp,
    criticalDamageBp: stats.critDamageBp,
  });
}

/** Describes the level-and-equipment stats under one rule set. Pure; no I/O. */
export function describeCharacterStats(source: PlayerStatSource): CharacterStatSheet {
  const base = deriveBaseCharacterStats(source.level, source.rules);
  const effective = fromCombatStats(
    applyCombatCaps(resolvePlayerCombatStats(source), source.rules.combat),
  );
  const criticalChanceMax = Math.min(
    CHARACTER_CRITICAL_CHANCE_MAX_BP,
    source.rules.combat.maxCritChanceBp,
  );
  const atMaximum = CHARACTER_STAT_IDS.filter(
    (stat) =>
      (stat === 'ATTACK_SPEED' &&
        effective.attackSpeedBp >= source.rules.combat.maxAttackSpeedBp) ||
      (stat === 'CRITICAL_CHANCE' && effective.criticalChanceBp >= criticalChanceMax),
  );
  return Object.freeze({
    base,
    effective,
    bonus: diffCharacterStats(base, effective),
    atMaximum: Object.freeze(atMaximum),
  });
}

/** What occupies each slot. Every item must sit in its catalog-defined slot. */
export type EquipmentLoadout = Readonly<Record<EquipmentSlot, ItemInstance | null>>;

export function equippedItemsOf(loadout: EquipmentLoadout): readonly ItemInstance[] {
  return EQUIPMENT_SLOTS.flatMap((slot) => {
    const item = loadout[slot];
    return item === null ? [] : [item];
  });
}

/**
 * A hypothetical loadout change, mirroring the two equipment commands: equip
 * names only the owned instance (its slot comes from the catalog), unequip
 * names only the slot.
 */
export type EquipmentChange =
  | { readonly kind: 'EQUIP'; readonly item: ItemInstance }
  | { readonly kind: 'UNEQUIP'; readonly slot: EquipmentSlot };

export interface EquipmentChangePreview {
  readonly kind: EquipmentChange['kind'];
  readonly slot: EquipmentSlot;
  /** The candidate for EQUIP; `null` for UNEQUIP. */
  readonly item: ItemInstance | null;
  /** The item that would leave the slot: the replaced item, or the one unequipped. */
  readonly displaced: ItemInstance | null;
  /** The change is already in effect (the candidate is worn, or the slot is empty). */
  readonly unchanged: boolean;
  readonly current: CharacterStatSheet;
  readonly preview: CharacterStatSheet;
  /** `preview.effective − current.effective`. */
  readonly delta: CharacterStatDelta;
}

function validateLoadout(loadout: EquipmentLoadout, catalog: ItemCatalog): void {
  for (const slot of EQUIPMENT_SLOTS) {
    const item = loadout[slot];
    if (item !== null && catalog.require(item.definitionId).slot !== slot) {
      throw new GameCoreError(
        'INVALID_ARGUMENT',
        `Equipped item ${item.id.toString()} does not belong in the ${slot} slot.`,
      );
    }
  }
}

/**
 * Resolves the stats of the current loadout and of the same loadout with one
 * change applied in memory, both through {@link describeCharacterStats}.
 *
 * Equipping replaces whatever the candidate's slot holds, so a candidate never
 * stacks with the item it replaces. Caps, minima and rounding apply exactly
 * as in combat, so a delta is the real effective change: a candidate that
 * adds Critical Chance to a hero already at the maximum shows zero. Nothing
 * here persists or mutates anything.
 */
export function previewEquipmentChange(input: {
  readonly level: number;
  readonly loadout: EquipmentLoadout;
  readonly change: EquipmentChange;
  readonly rules: GameRules;
  readonly catalog?: ItemCatalog;
}): EquipmentChangePreview {
  const catalog = input.catalog ?? ITEM_CATALOG;
  validateLoadout(input.loadout, catalog);

  const slot =
    input.change.kind === 'EQUIP'
      ? catalog.require(input.change.item.definitionId).slot
      : input.change.slot;
  const displaced = input.loadout[slot];
  const item = input.change.kind === 'EQUIP' ? input.change.item : null;
  const unchanged = item === null ? displaced === null : displaced?.id.equals(item.id) === true;

  const next: EquipmentLoadout = Object.freeze({ ...input.loadout, [slot]: item });
  const current = describeCharacterStats({
    level: input.level,
    equippedItems: equippedItemsOf(input.loadout),
    rules: input.rules,
  });
  const preview = unchanged
    ? current
    : describeCharacterStats({
        level: input.level,
        equippedItems: equippedItemsOf(next),
        rules: input.rules,
      });

  return Object.freeze({
    kind: input.change.kind,
    slot,
    item,
    displaced: unchanged && item !== null ? null : displaced,
    unchanged,
    current,
    preview,
    delta: diffCharacterStats(current.effective, preview.effective),
  });
}
