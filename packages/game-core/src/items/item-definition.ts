import { GameCoreError } from '../errors.js';
import type { EquipmentSlot } from './equipment-slot.js';
import { parseEquipmentSlot } from './equipment-slot.js';
import { ItemDefinitionId } from './item-id.js';

const NAME_KEY_PATTERN = /^item\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.name$/u;

export interface ItemDefinition {
  readonly id: ItemDefinitionId;
  readonly nameKey: string;
  readonly slot: EquipmentSlot;
}

export interface ItemDefinitionInput {
  readonly id: string;
  readonly nameKey: string;
  readonly slot: string;
}

export function createItemDefinition(input: ItemDefinitionInput): ItemDefinition {
  const id = ItemDefinitionId.parse(input.id);
  if (!NAME_KEY_PATTERN.test(input.nameKey) || input.nameKey !== `item.${id.toString()}.name`) {
    throw new GameCoreError(
      'INVALID_FORMAT',
      `Item name key must be "item.${id.toString()}.name".`,
    );
  }
  return Object.freeze({ id, nameKey: input.nameKey, slot: parseEquipmentSlot(input.slot) });
}
