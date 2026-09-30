import {
  EQUIPMENT_SLOTS,
  GAME_RULES_VERSION,
  ItemInstanceId,
  describeCharacterStats,
  equippedItemsOf,
  getGameRules,
  previewEquipmentChange,
  type CharacterStatSheet,
  type EquipmentChange,
  type EquipmentChangePreview,
  type EquipmentLoadout,
  type EquipmentSlot,
  type ItemInstance,
} from '@eternal-forge/game-core';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import type { Equipment, OwnedItem } from '../../inventory/domain/inventory.js';
import {
  CHARACTER_STATS_REPOSITORY,
  type CharacterLoadout,
  type CharacterStatsRepository,
} from './ports/character-stats-repository.port.js';

export interface CharacterStatsView {
  readonly level: number;
  readonly version: bigint;
  readonly rulesVersion: number;
  readonly equipment: Equipment;
  readonly sheet: CharacterStatSheet;
}

export type CharacterStatsResult =
  { readonly kind: 'found'; readonly view: CharacterStatsView } | { readonly kind: 'not-found' };

/** What the player asks to compare, exactly as the equipment commands accept it. */
export type StatsPreviewIntent =
  | { readonly kind: 'EQUIP'; readonly itemInstanceId: string }
  | { readonly kind: 'UNEQUIP'; readonly slot: EquipmentSlot };

export interface StatsPreviewView {
  readonly version: bigint;
  readonly rulesVersion: number;
  readonly preview: EquipmentChangePreview;
  /** The persisted candidate (EQUIP) or the item that would be removed (UNEQUIP). */
  readonly item: OwnedItem | null;
  /** The item the candidate would replace; always `null` for UNEQUIP. */
  readonly replaces: OwnedItem | null;
}

export type StatsPreviewResult =
  { readonly kind: 'found'; readonly view: StatsPreviewView } | { readonly kind: 'not-found' };

function loadoutOf(equipment: Equipment): EquipmentLoadout {
  const items: Record<EquipmentSlot, ItemInstance | null> = {
    WEAPON: null,
    HELMET: null,
    CHEST: null,
    GLOVES: null,
    BOOTS: null,
    RING: null,
    AMULET: null,
  };
  for (const slot of EQUIPMENT_SLOTS) items[slot] = equipment[slot]?.item ?? null;
  return Object.freeze(items);
}

/**
 * Query: the character's current stats (ADR-030).
 *
 * Resolved by Game Core from the persisted level and equipped rolls under the
 * rule set new combats use — the same pipeline, rules and inputs as the next
 * online combat's stat snapshot (ADR-029). Nothing is written.
 */
@Injectable()
export class GetCharacterStatsUseCase {
  constructor(
    @Inject(CHARACTER_STATS_REPOSITORY) private readonly repository: CharacterStatsRepository,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
  ): Promise<CharacterStatsResult> {
    const loadout = await this.repository.loadLoadout(identity.authUserId, characterId, null);
    if (loadout === null) return { kind: 'not-found' };
    const rules = getGameRules(GAME_RULES_VERSION);
    return {
      kind: 'found',
      view: {
        level: loadout.level,
        version: loadout.version,
        rulesVersion: rules.version,
        equipment: loadout.equipment,
        sheet: describeCharacterStats({
          level: loadout.level,
          equippedItems: equippedItemsOf(loadoutOf(loadout.equipment)),
          rules,
        }),
      },
    };
  }
}

/**
 * Query: the stats the character would have after one equip or unequip,
 * next to its current stats (ADR-030).
 *
 * The client names only the intent. Ownership of the character and of the
 * candidate is part of the read; a foreign or missing candidate is
 * `not-found`. The slot comes from the catalog, the change is applied to an
 * in-memory copy of the equipment, and both loadouts are resolved by Game
 * Core with caps. Nothing is written: not the equipment, not the version,
 * not a combat.
 */
@Injectable()
export class PreviewEquipmentChangeUseCase {
  constructor(
    @Inject(CHARACTER_STATS_REPOSITORY) private readonly repository: CharacterStatsRepository,
  ) {}

  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
    intent: StatsPreviewIntent,
  ): Promise<StatsPreviewResult> {
    const candidateId =
      intent.kind === 'EQUIP' ? ItemInstanceId.parse(intent.itemInstanceId).toString() : null;
    const loadout = await this.repository.loadLoadout(
      identity.authUserId,
      characterId,
      candidateId,
    );
    if (loadout === null) return { kind: 'not-found' };
    let change: EquipmentChange;
    if (intent.kind === 'EQUIP') {
      // Foreign and unknown item IDs deliberately have the same result.
      if (loadout.candidate === null) return { kind: 'not-found' };
      change = { kind: 'EQUIP', item: loadout.candidate.item };
    } else {
      change = { kind: 'UNEQUIP', slot: intent.slot };
    }

    const rules = getGameRules(GAME_RULES_VERSION);
    const preview = previewEquipmentChange({
      level: loadout.level,
      loadout: loadoutOf(loadout.equipment),
      change,
      rules,
    });

    return {
      kind: 'found',
      view: {
        version: loadout.version,
        rulesVersion: rules.version,
        preview,
        ...itemsOf(loadout, preview),
      },
    };
  }
}

/** The persisted records (with creation time) of the items a preview names. */
function itemsOf(
  loadout: CharacterLoadout,
  preview: EquipmentChangePreview,
): Pick<StatsPreviewView, 'item' | 'replaces'> {
  const displaced = preview.displaced === null ? null : loadout.equipment[preview.slot];
  return preview.kind === 'EQUIP'
    ? { item: loadout.candidate, replaces: displaced }
    : { item: displaced, replaces: null };
}
