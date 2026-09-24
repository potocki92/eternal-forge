import type {
  EquipmentResponse,
  EquipmentSlotDto,
  ItemInstanceDto,
  ItemRarityDto,
} from '@eternal-forge/contracts';

export const EQUIPMENT_SLOTS: readonly EquipmentSlotDto[] = [
  'HELMET',
  'WEAPON',
  'CHEST',
  'GLOVES',
  'BOOTS',
  'RING',
  'AMULET',
];

const RARITY_RANK: Readonly<Record<ItemRarityDto, number>> = {
  COMMON: 0,
  MAGIC: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
  MYTHIC: 5,
};

const ITEM_NAMES: Readonly<Record<string, string>> = {
  'item.forged_iron_sword.name': 'Forged Iron Sword',
  'item.emberguard_helm.name': 'Emberguard Helm',
  'item.ashsteel_cuirass.name': 'Ashsteel Cuirass',
  'item.smiths_gauntlets.name': "Smith's Gauntlets",
  'item.cinderwalk_boots.name': 'Cinderwalk Boots',
  'item.runed_iron_ring.name': 'Runed Iron Ring',
  'item.forgeheart_amulet.name': 'Forgeheart Amulet',
};

export function itemName(item: ItemInstanceDto): string {
  return ITEM_NAMES[item.nameKey] ?? item.definitionId.replaceAll('_', ' ');
}

export function slotLabel(slot: EquipmentSlotDto): string {
  return slot.charAt(0) + slot.slice(1).toLowerCase();
}

export function rarityPresentation(rarity: ItemRarityDto) {
  return { label: rarity, className: `rarity-${rarity.toLowerCase()}` } as const;
}

export function equippedIds(equipment: EquipmentResponse['equipment']): ReadonlySet<string> {
  return new Set(Object.values(equipment).flatMap((item) => (item === null ? [] : [item.id])));
}

export function unequippedItems(
  ownedItems: readonly ItemInstanceDto[],
  equipment: EquipmentResponse['equipment'],
): ItemInstanceDto[] {
  const equipped = equippedIds(equipment);
  return [...new Map(ownedItems.map((item) => [item.id, item])).values()]
    .filter((item) => !equipped.has(item.id))
    .sort(
      (left, right) =>
        RARITY_RANK[right.rarity] - RARITY_RANK[left.rarity] ||
        left.slot.localeCompare(right.slot) ||
        itemName(left).localeCompare(itemName(right)) ||
        left.id.localeCompare(right.id),
    );
}
