import { describe, expect, it } from 'vitest';
import {
  characterStatDeltaSchema,
  characterStatValuesSchema,
  characterStatsResponseSchema,
  statsPreviewQuerySchema,
  statsPreviewResponseSchema,
} from './character-stats.contract.js';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const values = {
  maxHealth: '1.3e2',
  damage: '3.15e1',
  attackSpeedBp: 12_500,
  criticalChanceBp: 1_435,
  criticalDamageBp: 16_800,
};
const zeroDelta = {
  maxHealth: '0',
  damage: '0',
  attackSpeedBp: 0,
  criticalChanceBp: 0,
  criticalDamageBp: 0,
};
const sheet = { base: values, bonus: zeroDelta, effective: values, atMaximum: [] };

function sword(id = ITEM_ID, slot = 'WEAPON') {
  return {
    id,
    definitionId: 'forged_iron_sword',
    rarity: 'RARE',
    generationVersion: 1,
    affixes: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        definitionId: 'damage_flat',
        stat: 'DAMAGE',
        operation: 'FLAT',
        value: '1.8e1',
        position: 0,
      },
    ],
    nameKey: 'item.forged_iron_sword.name',
    slot,
    createdAt: '2026-09-29T10:00:00.000Z',
  };
}

describe('character stat values', () => {
  it('carries canonical HugeNumber strings, including late-game magnitudes', () => {
    expect(
      characterStatValuesSchema.parse({ ...values, damage: '1.45e37', maxHealth: '9.99e5000' })
        .damage,
    ).toBe('1.45e37');
  });

  it('rejects non-canonical, negative or zero-health HugeNumbers', () => {
    for (const bad of [
      { ...values, damage: '31.5' },
      { ...values, damage: 31.5 },
      { ...values, damage: '-1e0' },
      { ...values, maxHealth: '0' },
    ]) {
      expect(characterStatValuesSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts only integer basis points within each stat’s legal range', () => {
    for (const bad of [
      { ...values, attackSpeedBp: 1.25 },
      { ...values, attackSpeedBp: 0 },
      { ...values, criticalChanceBp: 10_001 },
      { ...values, criticalChanceBp: -1 },
      { ...values, criticalDamageBp: 9_999 },
      { ...values, attackSpeedBp: '12500' },
    ]) {
      expect(characterStatValuesSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('requires all five stats and nothing else', () => {
    const { criticalDamageBp: _missing, ...partial } = values;
    expect(characterStatValuesSchema.safeParse(partial).success).toBe(false);
    expect(characterStatValuesSchema.safeParse({ ...values, armor: 0 }).success).toBe(false);
  });
});

describe('character stat deltas', () => {
  it('are signed', () => {
    expect(
      characterStatDeltaSchema.parse({ ...zeroDelta, maxHealth: '-3e1', attackSpeedBp: -2_500 }),
    ).toMatchObject({ maxHealth: '-3e1', attackSpeedBp: -2_500 });
  });

  it('reject non-integer rates and non-canonical amounts', () => {
    expect(
      characterStatDeltaSchema.safeParse({ ...zeroDelta, criticalChanceBp: 0.5 }).success,
    ).toBe(false);
    expect(characterStatDeltaSchema.safeParse({ ...zeroDelta, damage: '+18' }).success).toBe(false);
  });
});

describe('character stats response', () => {
  it('accepts a sheet with its sources', () => {
    const response = characterStatsResponseSchema.parse({
      level: 24,
      characterVersion: '7',
      rulesVersion: 3,
      stats: { ...sheet, atMaximum: ['CRITICAL_CHANCE'] },
      sources: [
        {
          stat: 'DAMAGE',
          operation: 'FLAT',
          value: '1.8e1',
          slot: 'WEAPON',
          itemDefinitionId: 'forged_iron_sword',
          itemNameKey: 'item.forged_iron_sword.name',
          itemRarity: 'RARE',
        },
      ],
    });
    expect(response.stats.atMaximum).toEqual(['CRITICAL_CHANCE']);
  });

  it('rejects unknown stats, unknown fields and a non-canonical version', () => {
    const valid = { level: 1, characterVersion: '0', rulesVersion: 3, stats: sheet, sources: [] };
    expect(characterStatsResponseSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, stats: { ...sheet, atMaximum: ['ARMOR'] } },
      { ...valid, characterVersion: '01' },
      { ...valid, seed: 'abc' },
      { ...valid, stats: { ...sheet, dps: '1e2' } },
    ]) {
      expect(characterStatsResponseSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('stats preview query', () => {
  it('accepts exactly one intent: an item to equip or a slot to empty', () => {
    expect(statsPreviewQuerySchema.parse({ equip: ITEM_ID })).toEqual({ equip: ITEM_ID });
    expect(statsPreviewQuerySchema.parse({ unequip: 'RING' })).toEqual({ unequip: 'RING' });
  });

  it('rejects client-authoritative fields, both intents and malformed values', () => {
    for (const bad of [
      {},
      { equip: ITEM_ID, unequip: 'RING' },
      { equip: ITEM_ID, slot: 'RING' },
      { equip: ITEM_ID, rarity: 'MYTHIC' },
      { equip: ITEM_ID, damage: '1e9' },
      { equip: ITEM_ID, affixes: '[]' },
      { equip: ITEM_ID, seed: 'x' },
      { equip: ITEM_ID, characterVersion: '99' },
      { equip: 'not-a-uuid' },
      { equip: [ITEM_ID, OTHER_ID] },
      { unequip: 'ring' },
    ]) {
      expect(statsPreviewQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('stats preview response', () => {
  const preview = {
    characterVersion: '3',
    rulesVersion: 3,
    change: { kind: 'EQUIP', slot: 'WEAPON', item: sword(), replaces: sword(OTHER_ID) },
    unchanged: false,
    current: sheet,
    preview: sheet,
    delta: { ...zeroDelta, damage: '1.8e1', maxHealth: '-3e1' },
  };

  it('identifies the candidate, the replaced item and the comparison', () => {
    const parsed = statsPreviewResponseSchema.parse(preview);
    expect(parsed.change.kind).toBe('EQUIP');
    expect(parsed.delta.maxHealth).toBe('-3e1');
  });

  it('accepts an unequip of a worn item and of an empty slot', () => {
    for (const item of [sword(), null]) {
      expect(
        statsPreviewResponseSchema.safeParse({
          ...preview,
          change: { kind: 'UNEQUIP', slot: 'WEAPON', item },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a change whose items do not belong to its slot', () => {
    for (const change of [
      { kind: 'EQUIP', slot: 'RING', item: sword(), replaces: null },
      { kind: 'EQUIP', slot: 'WEAPON', item: sword(), replaces: sword(OTHER_ID, 'RING') },
      { kind: 'UNEQUIP', slot: 'HELMET', item: sword() },
      { kind: 'SWAP', slot: 'WEAPON', item: sword() },
    ]) {
      expect(statsPreviewResponseSchema.safeParse({ ...preview, change }).success).toBe(false);
    }
  });
});
