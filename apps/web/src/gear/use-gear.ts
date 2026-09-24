'use client';

import type { EquipmentResponse, EquipmentSlotDto } from '@eternal-forge/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { equipItem, fetchEquipment, fetchInventory, unequipItem } from './gear-api';

export const inventoryKey = (userId: string, characterId: string) =>
  ['player', userId, 'character', characterId, 'inventory'] as const;
export const equipmentKey = (userId: string, characterId: string) =>
  ['player', userId, 'character', characterId, 'equipment'] as const;
const retry = (count: number, error: unknown) =>
  (!(error instanceof ApiError) || error.status === undefined || error.status >= 500) && count < 2;

export function useGear(userId: string, characterId: string) {
  const { tokens } = useAuth();
  const client = useQueryClient();
  const inventory = useQuery({
    queryKey: inventoryKey(userId, characterId),
    queryFn: ({ signal }) => fetchInventory(tokens, characterId, signal),
    retry,
  });
  const equipment = useQuery({
    queryKey: equipmentKey(userId, characterId),
    queryFn: ({ signal }) => fetchEquipment(tokens, characterId, signal),
    retry,
  });
  const settle = (state: EquipmentResponse) => {
    client.setQueryData(equipmentKey(userId, characterId), state);
    void client.invalidateQueries({ queryKey: inventoryKey(userId, characterId) });
  };
  const recover = () => {
    void client.invalidateQueries({ queryKey: equipmentKey(userId, characterId) });
    void client.invalidateQueries({ queryKey: inventoryKey(userId, characterId) });
  };
  const equip = useMutation({
    mutationFn: (id: string) => equipItem(tokens, characterId, id),
    onSuccess: settle,
    onError: recover,
  });
  const unequip = useMutation({
    mutationFn: (slot: EquipmentSlotDto) => unequipItem(tokens, characterId, slot),
    onSuccess: settle,
    onError: recover,
  });
  return {
    inventory,
    equipment,
    equip,
    unequip,
    retry: () => void Promise.all([inventory.refetch(), equipment.refetch()]),
  };
}
