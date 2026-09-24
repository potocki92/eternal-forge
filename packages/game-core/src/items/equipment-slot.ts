import { GameCoreError } from '../errors.js';

/** Canonical persistence/wire values for the seven initial equipment slots. */
export const EQUIPMENT_SLOTS = Object.freeze([
  'WEAPON',
  'HELMET',
  'CHEST',
  'GLOVES',
  'BOOTS',
  'RING',
  'AMULET',
] as const);

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export function parseEquipmentSlot(value: string): EquipmentSlot {
  const slot = EQUIPMENT_SLOTS.find((candidate) => candidate === value);
  if (slot === undefined) {
    throw new GameCoreError('INVALID_FORMAT', `Unknown equipment slot: "${value}".`);
  }
  return slot;
}
