import { describe, expect, it } from 'vitest';
import { GameCoreError } from '../errors.js';
import {
  EQUIPMENT_SLOTS,
  ITEM_CATALOG,
  ITEM_RARITIES,
  ItemCatalog,
  ItemDefinitionId,
  ItemInstanceId,
  compareItemRarity,
  createItemDefinition,
  createItemInstance,
  itemDefinitionFor,
  itemRarityRank,
  parseEquipmentSlot,
  parseItemInstance,
  parseItemRarity,
  serializeItemInstance,
} from './index.js';

const FIRST_INSTANCE = '018f47a2-86d1-7c4a-8a1d-15b45506a001';
const SECOND_INSTANCE = '018f47a2-86d1-7c4a-8a1d-15b45506a002';

function expectCode(operation: () => unknown, code: GameCoreError['code']): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('equipment slots', () => {
  it('has exactly the seven canonical Phase 5 slots in stable order', () => {
    expect(EQUIPMENT_SLOTS).toEqual([
      'WEAPON',
      'HELMET',
      'CHEST',
      'GLOVES',
      'BOOTS',
      'RING',
      'AMULET',
    ]);
    expect(Object.isFrozen(EQUIPMENT_SLOTS)).toBe(true);
    for (const slot of EQUIPMENT_SLOTS) expect(parseEquipmentSlot(slot)).toBe(slot);
  });

  it.each(['weapon', 'OFFHAND', '', ' WEAPON'])('rejects invalid slot %j', (slot) => {
    expectCode(() => parseEquipmentSlot(slot), 'INVALID_FORMAT');
  });
});

describe('item rarity', () => {
  it('has exactly the six canonical values and one explicit rank source', () => {
    expect(ITEM_RARITIES).toEqual(['COMMON', 'MAGIC', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']);
    expect(ITEM_RARITIES.map(itemRarityRank)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const rarity of ITEM_RARITIES) expect(parseItemRarity(rarity)).toBe(rarity);
  });

  it('orders every rarity without lexical ordering', () => {
    for (const [firstIndex, first] of ITEM_RARITIES.entries()) {
      for (const [secondIndex, second] of ITEM_RARITIES.entries()) {
        expect(compareItemRarity(first, second)).toBe(
          firstIndex === secondIndex ? 0 : firstIndex < secondIndex ? -1 : 1,
        );
      }
    }
    expect(compareItemRarity('EPIC', 'RARE')).toBe(1);
    expect('EPIC'.localeCompare('RARE')).toBeLessThan(0);
  });

  it.each(['common', 'UNIQUE', '', 'RARE '])('rejects invalid rarity %j', (rarity) => {
    expectCode(() => parseItemRarity(rarity), 'INVALID_FORMAT');
  });
});

describe('item definitions and catalog', () => {
  it.each(['', '_sword', 'IronSword', 'iron__sword', 'iron-sword', '1_sword'])(
    'rejects malformed definition ID %j',
    (id) => {
      expectCode(() => ItemDefinitionId.parse(id), 'INVALID_FORMAT');
    },
  );

  it('validates definitions and their stable content key', () => {
    const definition = createItemDefinition({
      id: 'iron_sword',
      nameKey: 'item.iron_sword.name',
      slot: 'WEAPON',
    });
    expect(definition.id.toString()).toBe('iron_sword');
    expect(definition.id.toJSON()).toBe('iron_sword');
    expect(Object.isFrozen(definition)).toBe(true);
    expectCode(
      () => createItemDefinition({ id: 'iron_sword', nameKey: 'Iron Sword', slot: 'WEAPON' }),
      'INVALID_FORMAT',
    );
    expectCode(
      () =>
        createItemDefinition({ id: 'iron_sword', nameKey: 'item.iron_sword.name', slot: 'HAT' }),
      'INVALID_FORMAT',
    );
  });

  it('covers every slot with unique stable IDs and deterministic iteration', () => {
    const definitions = ITEM_CATALOG.definitions();
    expect(definitions.map(({ id }) => id.toString())).toEqual([
      'forged_iron_sword',
      'emberguard_helm',
      'ashsteel_cuirass',
      'smiths_gauntlets',
      'cinderwalk_boots',
      'runed_iron_ring',
      'forgeheart_amulet',
    ]);
    expect(new Set(definitions.map(({ id }) => id.toString())).size).toBe(definitions.length);
    expect(new Set(definitions.map(({ slot }) => slot))).toEqual(new Set(EQUIPMENT_SLOTS));
    expect(Object.isFrozen(definitions)).toBe(true);
    for (const definition of definitions) {
      expect(ITEM_CATALOG.require(definition.id)).toBe(definition);
      expect(Reflect.set(definition, 'slot', 'HELMET')).toBe(false);
    }
  });

  it('rejects duplicates and reports unknown definitions intentionally', () => {
    const duplicate = {
      id: 'iron_sword',
      nameKey: 'item.iron_sword.name',
      slot: 'WEAPON',
    };
    expectCode(() => new ItemCatalog([duplicate, duplicate]), 'DUPLICATE_ITEM_DEFINITION');
    const unknown = ItemDefinitionId.parse('missing_item');
    expect(ITEM_CATALOG.get(unknown)).toBeUndefined();
    expectCode(() => ITEM_CATALOG.require(unknown), 'UNKNOWN_ITEM_DEFINITION');
  });
});

describe('item instances', () => {
  const definitionId = ItemDefinitionId.parse('forged_iron_sword');

  it.each([
    '',
    'not-a-uuid',
    '018F47A2-86D1-7C4A-8A1D-15B45506A001',
    '00000000-0000-0000-0000-000000000000',
  ])('rejects malformed instance ID %j', (id) => {
    expectCode(() => ItemInstanceId.parse(id), 'INVALID_FORMAT');
  });

  it('keeps distinct identity while instances share a definition and vary rarity', () => {
    const first = createItemInstance(
      { id: ItemInstanceId.parse(FIRST_INSTANCE), definitionId, rarity: 'COMMON' },
      ITEM_CATALOG,
    );
    const second = createItemInstance(
      { id: ItemInstanceId.parse(SECOND_INSTANCE), definitionId, rarity: 'LEGENDARY' },
      ITEM_CATALOG,
    );
    expect(first.id.equals(second.id)).toBe(false);
    expect(first.definitionId.equals(second.definitionId)).toBe(true);
    expect(first.rarity).toBe('COMMON');
    expect(second.rarity).toBe('LEGENDARY');
    expect(itemDefinitionFor(first, ITEM_CATALOG).slot).toBe('WEAPON');
    expect(first).not.toHaveProperty('slot');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first, 'rarity', 'MYTHIC')).toBe(false);
    expect(first.rarity).toBe('COMMON');
  });

  it('rejects an otherwise valid instance with an unknown definition', () => {
    expectCode(
      () =>
        createItemInstance(
          {
            id: ItemInstanceId.parse(FIRST_INSTANCE),
            definitionId: ItemDefinitionId.parse('missing_item'),
            rarity: 'RARE',
          },
          ITEM_CATALOG,
        ),
      'UNKNOWN_ITEM_DEFINITION',
    );
  });

  it('round-trips the canonical persistence/wire representation', () => {
    const serialized = {
      id: FIRST_INSTANCE,
      definitionId: 'forged_iron_sword',
      rarity: 'MYTHIC',
      generationVersion: 0,
      affixes: [],
    };
    const instance = parseItemInstance(serialized, ITEM_CATALOG);
    expect(serializeItemInstance(instance)).toEqual(serialized);
    expect(Object.isFrozen(serializeItemInstance(instance))).toBe(true);
  });
});
