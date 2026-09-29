import type { EquipmentResponse } from '@eternal-forge/contracts';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  characterStatsKey,
  equipmentKey,
  inventoryKey,
  invalidateGearState,
  markGearStateStale,
  statsPreviewKey,
} from './use-gear';

const USER = 'user-1';
const CHARACTER = 'hero-1';
const ITEM = '11111111-1111-4111-8111-111111111111';

const equipment = (characterVersion: string): EquipmentResponse => ({
  equipment: {
    WEAPON: null,
    HELMET: null,
    CHEST: null,
    GLOVES: null,
    BOOTS: null,
    RING: null,
    AMULET: null,
  },
  characterVersion,
});

function seeded() {
  const client = new QueryClient();
  client.setQueryData(inventoryKey(USER, CHARACTER), { ownedItems: [] });
  client.setQueryData(equipmentKey(USER, CHARACTER), equipment('3'));
  client.setQueryData(characterStatsKey(USER, CHARACTER), { cached: true });
  client.setQueryData(statsPreviewKey(USER, CHARACTER, '3', { equip: ITEM }), { cached: true });
  client.setQueryData(['player', 'someone-else', 'character', CHARACTER, 'stats'], {});
  const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { client, stale };
}

describe('gear query keys', () => {
  it('scope every entry by user and character, previews by version and intent', () => {
    expect(statsPreviewKey(USER, CHARACTER, '3', { equip: ITEM })).toEqual([
      'player',
      USER,
      'character',
      CHARACTER,
      'stats',
      'preview',
      '3',
      `equip:${ITEM}`,
    ]);
    expect(statsPreviewKey(USER, CHARACTER, '4', { equip: ITEM })).not.toEqual(
      statsPreviewKey(USER, CHARACTER, '3', { equip: ITEM }),
    );
    expect(statsPreviewKey(USER, CHARACTER, '3', { unequip: 'RING' }).at(-1)).toBe('unequip:RING');
  });
});

describe('invalidateGearState', () => {
  it('after an equip, writes the new equipment and refreshes inventory, stats and previews', async () => {
    const { client, stale } = seeded();
    await invalidateGearState(client, USER, CHARACTER, equipment('4'));

    expect(client.getQueryData(equipmentKey(USER, CHARACTER))).toEqual(equipment('4'));
    expect(stale(equipmentKey(USER, CHARACTER))).toBe(false);
    expect(stale(inventoryKey(USER, CHARACTER))).toBe(true);
    expect(stale(characterStatsKey(USER, CHARACTER))).toBe(true);
    expect(stale(statsPreviewKey(USER, CHARACTER, '3', { equip: ITEM }))).toBe(true);
    expect(stale(['player', 'someone-else', 'character', CHARACTER, 'stats'])).toBe(false);
  });

  it('after a failure, re-reads everything including the equipment', async () => {
    const { client, stale } = seeded();
    await invalidateGearState(client, USER, CHARACTER);
    expect(stale(equipmentKey(USER, CHARACTER))).toBe(true);
    expect(stale(characterStatsKey(USER, CHARACTER))).toBe(true);
  });
});

describe('markGearStateStale', () => {
  it('marks everything stale after a combat, so the Gear screen re-reads it on arrival', () => {
    const { client, stale } = seeded();
    markGearStateStale(client, USER, CHARACTER, false);
    expect(stale(equipmentKey(USER, CHARACTER))).toBe(true);
    expect(stale(characterStatsKey(USER, CHARACTER))).toBe(true);
    expect(stale(statsPreviewKey(USER, CHARACTER, '3', { equip: ITEM }))).toBe(true);
  });
});
