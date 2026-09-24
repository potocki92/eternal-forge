import {
  equipmentResponseSchema,
  inventoryResponseSchema,
  type EquipmentResponse,
  type EquipmentSlotDto,
  type InventoryResponse,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { authorizedJson } from '@/lib/api-client';

const base = (characterId: string) => `/player/characters/${encodeURIComponent(characterId)}`;

export function fetchInventory(
  tokens: AccessTokenSource,
  characterId: string,
  signal?: AbortSignal,
): Promise<InventoryResponse> {
  return authorizedJson(tokens, {
    path: `${base(characterId)}/inventory`,
    schema: inventoryResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
export function fetchEquipment(
  tokens: AccessTokenSource,
  characterId: string,
  signal?: AbortSignal,
): Promise<EquipmentResponse> {
  return authorizedJson(tokens, {
    path: `${base(characterId)}/equipment`,
    schema: equipmentResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
export function equipItem(
  tokens: AccessTokenSource,
  characterId: string,
  itemInstanceId: string,
): Promise<EquipmentResponse> {
  return authorizedJson(tokens, {
    path: `${base(characterId)}/equipment/equip`,
    method: 'POST',
    body: { itemInstanceId },
    schema: equipmentResponseSchema,
  });
}
export function unequipItem(
  tokens: AccessTokenSource,
  characterId: string,
  slot: EquipmentSlotDto,
): Promise<EquipmentResponse> {
  return authorizedJson(tokens, {
    path: `${base(characterId)}/equipment/unequip`,
    method: 'POST',
    body: { slot },
    schema: equipmentResponseSchema,
  });
}
