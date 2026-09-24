import { GameCoreError } from '../errors.js';
import type { ItemDefinition, ItemDefinitionInput } from './item-definition.js';
import { createItemDefinition } from './item-definition.js';
import type { ItemDefinitionId } from './item-id.js';

const INITIAL_DEFINITIONS = [
  { id: 'forged_iron_sword', nameKey: 'item.forged_iron_sword.name', slot: 'WEAPON' },
  { id: 'emberguard_helm', nameKey: 'item.emberguard_helm.name', slot: 'HELMET' },
  { id: 'ashsteel_cuirass', nameKey: 'item.ashsteel_cuirass.name', slot: 'CHEST' },
  { id: 'smiths_gauntlets', nameKey: 'item.smiths_gauntlets.name', slot: 'GLOVES' },
  { id: 'cinderwalk_boots', nameKey: 'item.cinderwalk_boots.name', slot: 'BOOTS' },
  { id: 'runed_iron_ring', nameKey: 'item.runed_iron_ring.name', slot: 'RING' },
  { id: 'forgeheart_amulet', nameKey: 'item.forgeheart_amulet.name', slot: 'AMULET' },
] as const;

/** Immutable, deterministic static-content registry with constant-time lookup. */
export class ItemCatalog {
  private readonly byId: ReadonlyMap<string, ItemDefinition>;
  private readonly ordered: readonly ItemDefinition[];

  public constructor(inputs: readonly ItemDefinitionInput[]) {
    const byId = new Map<string, ItemDefinition>();
    const definitions = inputs.map(createItemDefinition);
    for (const definition of definitions) {
      const key = definition.id.toString();
      if (byId.has(key)) {
        throw new GameCoreError(
          'DUPLICATE_ITEM_DEFINITION',
          `Duplicate item definition ID: "${key}".`,
        );
      }
      byId.set(key, definition);
    }
    this.byId = byId;
    this.ordered = Object.freeze([...definitions]);
    Object.freeze(this);
  }

  public get(id: ItemDefinitionId): ItemDefinition | undefined {
    return this.byId.get(id.toString());
  }

  public require(id: ItemDefinitionId): ItemDefinition {
    const definition = this.get(id);
    if (definition === undefined) {
      throw new GameCoreError(
        'UNKNOWN_ITEM_DEFINITION',
        `Unknown item definition ID: "${id.toString()}".`,
      );
    }
    return definition;
  }

  /** Catalog declaration order, returned as one frozen, non-mutable view. */
  public definitions(): readonly ItemDefinition[] {
    return this.ordered;
  }
}

export const ITEM_CATALOG = new ItemCatalog(INITIAL_DEFINITIONS);
