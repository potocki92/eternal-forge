import {
  GAME_RULES_VERSION,
  ITEM_CATALOG,
  ItemDefinitionId,
  ItemInstanceId,
  createCharacter,
  createItemInstance,
  getGameRules,
  type EquipmentSlot,
  type ItemInstance,
  type RolledAffix,
} from '@eternal-forge/game-core';
import { describe, expect, it } from 'vitest';
import type { Equipment, OwnedItem } from '../../inventory/domain/inventory.js';
import {
  GetCharacterStatsUseCase,
  PreviewEquipmentChangeUseCase,
} from './character-stats.use-cases.js';
import type {
  CharacterLoadout,
  CharacterStatsRepository,
} from './ports/character-stats-repository.port.js';

const owner = { authUserId: 'owner', sessionId: undefined };
const intruder = { authUserId: 'intruder', sessionId: undefined };
const CHARACTER = 'hero';
let counter = 0;

function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function affix(
  definitionId: string,
  stat: RolledAffix['stat'],
  operation: RolledAffix['operation'],
  value: string,
  position = 0,
): RolledAffix {
  return { id: uuid(), definitionId, stat, operation, value, position };
}

function owned(definitionId: string, affixes: readonly RolledAffix[] = [], legacy = false) {
  const item: ItemInstance = createItemInstance(
    {
      id: ItemInstanceId.parse(uuid()),
      definitionId: ItemDefinitionId.parse(definitionId),
      rarity: affixes.length === 0 ? 'COMMON' : 'EPIC',
      ...(legacy ? {} : { generationVersion: 1 }),
      affixes,
    },
    ITEM_CATALOG,
  );
  return { item, createdAt: new Date(0) } satisfies OwnedItem;
}

const damage = (value: string, position = 0) =>
  affix('damage_flat', 'DAMAGE', 'FLAT', value, position);
const critChance = (value: string, position = 0) =>
  affix('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', value, position);

/**
 * An in-memory read model of one character. Its only method is a read, as
 * the port's: a query cannot write, and `reads` proves what it asked for.
 */
function repository(options: {
  level?: number;
  equipped?: Partial<Record<EquipmentSlot, OwnedItem>>;
  inventory?: readonly OwnedItem[];
}) {
  const equipment: Equipment = {
    WEAPON: null,
    HELMET: null,
    CHEST: null,
    GLOVES: null,
    BOOTS: null,
    RING: null,
    AMULET: null,
    ...options.equipped,
  };
  const owns = [
    ...Object.values(equipment).flatMap((entry) => (entry === null ? [] : [entry])),
    ...(options.inventory ?? []),
  ];
  const reads: (string | null)[] = [];
  const port: CharacterStatsRepository = {
    loadLoadout(authUserId, characterId, candidateItemId): Promise<CharacterLoadout | null> {
      reads.push(candidateItemId);
      if (authUserId !== owner.authUserId || characterId !== CHARACTER)
        return Promise.resolve(null);
      return Promise.resolve({
        level: options.level ?? 1,
        version: 4n,
        equipment,
        candidate: owns.find((entry) => entry.item.id.toString() === candidateItemId) ?? null,
      });
    },
  };
  return { port, reads };
}

const rules = getGameRules(GAME_RULES_VERSION);

describe('GetCharacterStatsUseCase', () => {
  const stats = async (repo: ReturnType<typeof repository>, identity = owner) =>
    new GetCharacterStatsUseCase(repo.port).execute(identity, CHARACTER);

  it('resolves the level baseline with no gear, under the current rules', async () => {
    const result = await stats(repository({ level: 9 }));
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    const level9 = createCharacter(9, rules).stats;
    expect(result.view.rulesVersion).toBe(GAME_RULES_VERSION);
    expect(result.view.version).toBe(4n);
    expect(result.view.sheet.effective.damage.eq(level9.damage)).toBe(true);
    expect(result.view.sheet.effective.maxHealth.eq(level9.maxHealth)).toBe(true);
    expect(result.view.sheet.bonus.damage.isZero()).toBe(true);
  });

  it('gives Common and legacy equipped items no power', async () => {
    const result = await stats(
      repository({
        equipped: { WEAPON: owned('forged_iron_sword'), RING: owned('runed_iron_ring', [], true) },
      }),
    );
    if (result.kind !== 'found') throw new Error('expected stats');
    expect(result.view.sheet.effective).toEqual(result.view.sheet.base);
  });

  it('applies one powered item and aggregates several', async () => {
    const one = await stats(
      repository({ equipped: { WEAPON: owned('forged_iron_sword', [damage('2e1')]) } }),
    );
    if (one.kind !== 'found') throw new Error('expected stats');
    expect(one.view.sheet.effective.damage.toString()).toBe('3e1');

    const several = await stats(
      repository({
        equipped: {
          WEAPON: owned('forged_iron_sword', [damage('2e1')]),
          RING: owned('runed_iron_ring', [
            damage('5e0'),
            affix('damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', '1000', 1),
          ]),
          HELMET: owned('emberguard_helm', [critChance('250')]),
        },
      }),
    );
    if (several.kind !== 'found') throw new Error('expected stats');
    // (10 + 20 + 5) × 1.10 = 38.5
    expect(several.view.sheet.effective.damage.toString()).toBe('3.85e1');
    expect(several.view.sheet.bonus.damage.toString()).toBe('2.85e1');
    expect(several.view.sheet.effective.criticalChanceBp).toBe(750);
  });

  it('reports the capped effective value and flags the maximum', async () => {
    const result = await stats(
      repository({
        equipped: { HELMET: owned('emberguard_helm', [critChance('9800')]) },
      }),
    );
    if (result.kind !== 'found') throw new Error('expected stats');
    expect(result.view.sheet.effective.criticalChanceBp).toBe(10_000);
    expect(result.view.sheet.atMaximum).toEqual(['CRITICAL_CHANCE']);
  });

  it('refuses to count one instance twice when persistence returns it in two slots', async () => {
    const ring = owned('runed_iron_ring', [damage('1e1')]);
    await expect(stats(repository({ equipped: { RING: ring, AMULET: ring } }))).rejects.toThrow(
      /appears more than once/u,
    );
  });

  it('is not-found for another player, and never reads inventory candidates', async () => {
    const repo = repository({});
    expect((await stats(repo, intruder)).kind).toBe('not-found');
    expect((await stats(repo)).kind).toBe('found');
    expect(repo.reads).toEqual([null, null]);
  });
});

describe('PreviewEquipmentChangeUseCase', () => {
  const preview = (
    repo: ReturnType<typeof repository>,
    intent: Parameters<PreviewEquipmentChangeUseCase['execute']>[2],
    identity = owner,
  ) => new PreviewEquipmentChangeUseCase(repo.port).execute(identity, CHARACTER, intent);

  async function found(
    repo: ReturnType<typeof repository>,
    intent: Parameters<PreviewEquipmentChangeUseCase['execute']>[2],
  ) {
    const result = await preview(repo, intent);
    if (result.kind !== 'found') throw new Error('expected a preview');
    return result.view;
  }

  it('previews an equip into an empty slot, reading only that candidate', async () => {
    const ring = owned('runed_iron_ring', [damage('1.2e1')]);
    const repo = repository({ inventory: [ring] });
    const view = await found(repo, { kind: 'EQUIP', itemInstanceId: ring.item.id.toString() });

    expect(repo.reads).toEqual([ring.item.id.toString()]);
    expect(view.preview.slot).toBe('RING');
    expect(view.item).toBe(ring);
    expect(view.replaces).toBeNull();
    expect(view.preview.delta.damage.toString()).toBe('1.2e1');
    expect(view.version).toBe(4n);
  });

  it('replaces the item in the same slot instead of stacking with it', async () => {
    const swordA = owned('forged_iron_sword', [damage('1e1')]);
    const swordB = owned('forged_iron_sword', [damage('2e1')]);
    const view = await found(repository({ equipped: { WEAPON: swordA }, inventory: [swordB] }), {
      kind: 'EQUIP',
      itemInstanceId: swordB.item.id.toString(),
    });
    expect(view.replaces).toBe(swordA);
    expect(view.preview.current.effective.damage.toString()).toBe('2e1');
    expect(view.preview.preview.effective.damage.toString()).toBe('3e1');
    expect(view.preview.delta.damage.toString()).toBe('1e1');
  });

  it('marks an already-equipped candidate unchanged, with nothing replaced', async () => {
    const sword = owned('forged_iron_sword', [damage('2e1')]);
    const view = await found(repository({ equipped: { WEAPON: sword } }), {
      kind: 'EQUIP',
      itemInstanceId: sword.item.id.toString(),
    });
    expect(view.preview.unchanged).toBe(true);
    expect(view.replaces).toBeNull();
    expect(view.preview.delta.damage.isZero()).toBe(true);
  });

  it('treats a missing item and another character’s item alike: not-found', async () => {
    const foreign = owned('forged_iron_sword', [damage('2.5e1')]);
    const repo = repository({});
    for (const itemInstanceId of [uuid(), foreign.item.id.toString()]) {
      expect((await preview(repo, { kind: 'EQUIP', itemInstanceId })).kind).toBe('not-found');
    }
    const mine = owned('forged_iron_sword');
    expect(
      (
        await preview(
          repository({ inventory: [mine] }),
          { kind: 'EQUIP', itemInstanceId: mine.item.id.toString() },
          intruder,
        )
      ).kind,
    ).toBe('not-found');
  });

  it('shows a Common candidate as no effective change', async () => {
    const common = owned('emberguard_helm');
    const view = await found(repository({ inventory: [common] }), {
      kind: 'EQUIP',
      itemInstanceId: common.item.id.toString(),
    });
    expect(view.preview.unchanged).toBe(false);
    expect(view.preview.preview.effective).toEqual(view.preview.current.effective);
  });

  it('never claims a gain beyond a cap', async () => {
    const helm = owned('emberguard_helm', [critChance('9500')]);
    const ring = owned('runed_iron_ring', [critChance('400')]);
    const view = await found(repository({ equipped: { HELMET: helm }, inventory: [ring] }), {
      kind: 'EQUIP',
      itemInstanceId: ring.item.id.toString(),
    });
    expect(view.preview.current.effective.criticalChanceBp).toBe(10_000);
    expect(view.preview.preview.effective.criticalChanceBp).toBe(10_000);
    expect(view.preview.delta.criticalChanceBp).toBe(0);
  });

  it('previews an unequip as the loadout without the item, and an empty slot as unchanged', async () => {
    const amulet = owned('forgeheart_amulet', [
      affix('max_health_flat', 'MAX_HEALTH', 'FLAT', '6e1'),
    ]);
    const repo = repository({ equipped: { AMULET: amulet } });
    const removed = await found(repo, { kind: 'UNEQUIP', slot: 'AMULET' });
    expect(removed.item).toBe(amulet);
    expect(removed.replaces).toBeNull();
    expect(removed.preview.delta.maxHealth.toString()).toBe('-6e1');

    const empty = await found(repo, { kind: 'UNEQUIP', slot: 'BOOTS' });
    expect(empty.preview.unchanged).toBe(true);
    expect(empty.item).toBeNull();
    expect(repo.reads).toEqual([null, null]);
  });

  it('rejects a malformed item id before reading anything', async () => {
    const repo = repository({});
    await expect(preview(repo, { kind: 'EQUIP', itemInstanceId: 'not-a-uuid' })).rejects.toThrow();
    expect(repo.reads).toEqual([]);
  });
});
