'use client';

import type {
  EquipmentResponse,
  EquipmentSlotDto,
  StatsPreviewQuery,
} from '@eternal-forge/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { equipItem, fetchEquipment, fetchInventory, unequipItem } from './gear-api';
import { fetchCharacterStats, fetchStatsPreview } from './stats/stats-api';

/**
 * Everything the server derives from one character's gear lives under one
 * prefix, scoped by user so an account never sees another's cache:
 *
 * ```
 * ['player', userId, 'character', characterId]
 *   ├─ 'inventory'
 *   ├─ 'equipment'
 *   └─ 'stats'
 *        └─ 'preview', characterVersion, intent
 * ```
 */
export const gearStateKey = (userId: string, characterId: string) =>
  ['player', userId, 'character', characterId] as const;
export const inventoryKey = (userId: string, characterId: string) =>
  [...gearStateKey(userId, characterId), 'inventory'] as const;
export const equipmentKey = (userId: string, characterId: string) =>
  [...gearStateKey(userId, characterId), 'equipment'] as const;
export const characterStatsKey = (userId: string, characterId: string) =>
  [...gearStateKey(userId, characterId), 'stats'] as const;
/**
 * A preview is keyed by the character version it compares against. Any
 * character write (equip, unequip, combat, stage choice, offline claim) moves
 * the version on, so a preview can never be shown for a loadout it was not
 * computed for.
 */
export const statsPreviewKey = (
  userId: string,
  characterId: string,
  characterVersion: string,
  intent: StatsPreviewQuery,
) =>
  [
    ...characterStatsKey(userId, characterId),
    'preview',
    characterVersion,
    'equip' in intent ? `equip:${intent.equip}` : `unequip:${intent.unequip}`,
  ] as const;

/**
 * The one invalidation rule for a gear change: inventory, stats and every
 * preview are refetched. When the server has just answered with the new
 * equipment, that answer is written first and not requested again.
 */
export function invalidateGearState(
  client: QueryClient,
  userId: string,
  characterId: string,
  equipment?: EquipmentResponse,
): Promise<void> {
  if (equipment !== undefined) client.setQueryData(equipmentKey(userId, characterId), equipment);
  return client.invalidateQueries({
    queryKey: gearStateKey(userId, characterId),
    ...(equipment === undefined ? {} : { predicate: (query) => query.queryKey[4] !== 'equipment' }),
  });
}

/**
 * A combat or an offline claim changed the character outside the Gear screen:
 * its version moved on, so every gear-derived entry is marked stale (nothing
 * is fetched for screens that are not showing it). Gear did not change, so
 * stats are refetched only when the level did.
 */
export function markGearStateStale(
  client: QueryClient,
  userId: string,
  characterId: string,
  levelChanged: boolean,
): void {
  void client.invalidateQueries({
    queryKey: gearStateKey(userId, characterId),
    refetchType: 'none',
  });
  if (levelChanged) {
    void client.invalidateQueries({
      queryKey: characterStatsKey(userId, characterId),
      exact: true,
    });
  }
}

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
  const settle = (state: EquipmentResponse) =>
    invalidateGearState(client, userId, characterId, state);
  // A failed change (a conflict with another device, a lost connection)
  // leaves nothing trustworthy in the cache: the whole gear state is re-read.
  const recover = () => invalidateGearState(client, userId, characterId);
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

/** The character's authoritative stats; refetched whenever its gear changes. */
export function useCharacterStats(userId: string, characterId: string) {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: characterStatsKey(userId, characterId),
    queryFn: ({ signal }) => fetchCharacterStats(tokens, characterId, signal),
    retry,
  });
}

export interface StatsPreviewRequest {
  readonly intent: StatsPreviewQuery;
  /** The version of the equipment the player is looking at. */
  readonly characterVersion: string;
}

/** The server's comparison for one intent, or idle when `request` is `null`. */
export function useStatsPreview(
  userId: string,
  characterId: string,
  request: StatsPreviewRequest | null,
) {
  const { tokens } = useAuth();
  return useQuery({
    queryKey:
      request === null
        ? [...characterStatsKey(userId, characterId), 'preview', 'idle']
        : statsPreviewKey(userId, characterId, request.characterVersion, request.intent),
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('No preview requested.');
      return fetchStatsPreview(tokens, characterId, request.intent, signal);
    },
    enabled: request !== null,
    // Shown again, a preview is re-asked in the background: cheap, and it
    // catches a change made elsewhere since this page last read its equipment.
    staleTime: 0,
    retry,
  });
}
