import { describe, expect, it } from 'vitest';
import {
  equipmentResponseSchema,
  equipItemRequestSchema,
  unequipItemRequestSchema,
} from './inventory.contract.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('inventory contracts', () => {
  it('accepts opaque equip intent and rejects client-authoritative fields', () => {
    expect(equipItemRequestSchema.parse({ itemInstanceId: id })).toEqual({ itemInstanceId: id });
    expect(() => equipItemRequestSchema.parse({ itemInstanceId: id, rarity: 'MYTHIC' })).toThrow();
    expect(() => equipItemRequestSchema.parse({ itemInstanceId: id, slot: 'HELMET' })).toThrow();
  });
  it('accepts only canonical unequip slots', () => {
    expect(unequipItemRequestSchema.parse({ slot: 'WEAPON' })).toEqual({ slot: 'WEAPON' });
    expect(() => unequipItemRequestSchema.parse({ slot: 'weapon' })).toThrow();
  });
  it('requires all seven authoritative equipment positions', () => {
    expect(
      equipmentResponseSchema.parse({
        equipment: {
          WEAPON: null,
          HELMET: null,
          CHEST: null,
          GLOVES: null,
          BOOTS: null,
          RING: null,
          AMULET: null,
        },
        characterVersion: '0',
      }).equipment.RING,
    ).toBeNull();
  });
});
