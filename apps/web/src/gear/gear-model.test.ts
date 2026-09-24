import type { EquipmentResponse, ItemInstanceDto } from '@eternal-forge/contracts';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_SLOTS, equippedIds, rarityPresentation, unequippedItems } from './gear-model';

const item = (
  id: string,
  rarity: ItemInstanceDto['rarity'],
  slot: ItemInstanceDto['slot'],
  nameKey = 'item.forged_iron_sword.name',
): ItemInstanceDto => ({
  id,
  definitionId: 'forged_iron_sword',
  rarity,
  nameKey,
  slot,
  createdAt: '2026-09-24T00:00:00.000Z',
});
const empty = (): EquipmentResponse['equipment'] => ({
  WEAPON: null,
  HELMET: null,
  CHEST: null,
  GLOVES: null,
  BOOTS: null,
  RING: null,
  AMULET: null,
});

describe('gear presentation model', () => {
  it('covers every canonical slot in loadout order', () => {
    expect(EQUIPMENT_SLOTS).toEqual([
      'HELMET',
      'WEAPON',
      'CHEST',
      'GLOVES',
      'BOOTS',
      'RING',
      'AMULET',
    ]);
  });
  it('subtracts equipped identities, suppresses duplicate instances and sorts by rarity', () => {
    const common = item('11111111-1111-4111-8111-111111111111', 'COMMON', 'WEAPON');
    const mythic = item(
      '22222222-2222-4222-8222-222222222222',
      'MYTHIC',
      'RING',
      'item.runed_iron_ring.name',
    );
    const rare = item(
      '33333333-3333-4333-8333-333333333333',
      'RARE',
      'CHEST',
      'item.ashsteel_cuirass.name',
    );
    const equipment = { ...empty(), WEAPON: common };
    expect([...equippedIds(equipment)]).toEqual([common.id]);
    expect(
      unequippedItems([common, rare, mythic, mythic], equipment).map((entry) => entry.id),
    ).toEqual([mythic.id, rare.id]);
  });
  it.each(['COMMON', 'MAGIC', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const)(
    'always presents rarity %s as text',
    (rarity) => {
      expect(rarityPresentation(rarity)).toEqual({
        label: rarity,
        className: `rarity-${rarity.toLowerCase()}`,
      });
    },
  );
});
