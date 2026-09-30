import type {
  CharacterStatDeltaDto,
  CharacterStatSheetDto,
  CharacterStatSourceDto,
  CharacterStatValuesDto,
  CharacterStatsResponse,
  StatsPreviewChangeDto,
  StatsPreviewResponse,
} from '@eternal-forge/contracts';
import {
  CHARACTER_STAT_IDS,
  EQUIPMENT_SLOTS,
  ITEM_CATALOG,
  type CharacterStatDelta,
  type CharacterStatSheet,
  type CharacterStats,
} from '@eternal-forge/game-core';
import type { Equipment } from '../../inventory/domain/inventory.js';
import { toItemDto } from '../../inventory/presentation/inventory.mapper.js';
import type {
  CharacterStatsView,
  StatsPreviewView,
} from '../application/character-stats.use-cases.js';

function toValuesDto(stats: CharacterStats): CharacterStatValuesDto {
  return {
    maxHealth: stats.maxHealth.toString(),
    damage: stats.damage.toString(),
    attackSpeedBp: stats.attackSpeedBp,
    criticalChanceBp: stats.criticalChanceBp,
    criticalDamageBp: stats.criticalDamageBp,
  };
}

function toDeltaDto(delta: CharacterStatDelta): CharacterStatDeltaDto {
  return {
    maxHealth: delta.maxHealth.toString(),
    damage: delta.damage.toString(),
    attackSpeedBp: delta.attackSpeedBp,
    criticalChanceBp: delta.criticalChanceBp,
    criticalDamageBp: delta.criticalDamageBp,
  };
}

function toSheetDto(sheet: CharacterStatSheet): CharacterStatSheetDto {
  return {
    base: toValuesDto(sheet.base),
    bonus: toDeltaDto(sheet.bonus),
    effective: toValuesDto(sheet.effective),
    atMaximum: [...sheet.atMaximum],
  };
}

/**
 * The equipped affix rolls that fed the resolver, in canonical order: stat,
 * then slot, then roll position. Item identities stay internal; the player
 * sees the item's name, rarity and the roll.
 */
function toSourcesDto(equipment: Equipment): CharacterStatSourceDto[] {
  return CHARACTER_STAT_IDS.flatMap((stat) =>
    EQUIPMENT_SLOTS.flatMap((slot) => {
      const owned = equipment[slot];
      if (owned === null) return [];
      const definition = ITEM_CATALOG.require(owned.item.definitionId);
      return [...owned.item.affixes]
        .sort((left, right) => left.position - right.position)
        .filter((affix) => affix.stat === stat)
        .map((affix) => ({
          stat,
          operation: affix.operation,
          value: affix.value,
          slot,
          itemDefinitionId: definition.id.toString(),
          itemNameKey: definition.nameKey,
          itemRarity: owned.item.rarity,
        }));
    }),
  );
}

export function toCharacterStatsResponse(view: CharacterStatsView): CharacterStatsResponse {
  return {
    level: view.level,
    characterVersion: view.version.toString(),
    rulesVersion: view.rulesVersion,
    stats: toSheetDto(view.sheet),
    sources: toSourcesDto(view.equipment),
  };
}

function toChangeDto(view: StatsPreviewView): StatsPreviewChangeDto {
  const { preview, item, replaces } = view;
  if (preview.kind === 'UNEQUIP') {
    return { kind: 'UNEQUIP', slot: preview.slot, item: item === null ? null : toItemDto(item) };
  }
  if (item === null) throw new Error('An equip preview always names its candidate.');
  return {
    kind: 'EQUIP',
    slot: preview.slot,
    item: toItemDto(item),
    replaces: replaces === null ? null : toItemDto(replaces),
  };
}

export function toStatsPreviewResponse(view: StatsPreviewView): StatsPreviewResponse {
  return {
    characterVersion: view.version.toString(),
    rulesVersion: view.rulesVersion,
    change: toChangeDto(view),
    unchanged: view.preview.unchanged,
    current: toSheetDto(view.preview.current),
    preview: toSheetDto(view.preview.preview),
    delta: toDeltaDto(view.preview.delta),
  };
}
