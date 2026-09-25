import type {
  CharacterStatId,
  StatModifier,
  StatModifierOperation,
} from '../character-stats/index.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { createRng, deriveSeed } from '../rng/index.js';
import type { EquipmentSlot } from './equipment-slot.js';
import type { ItemDefinition } from './item-definition.js';
import type { ItemRarity } from './item-rarity.js';

export const ITEM_GENERATION_VERSION = 1;
export const LEGACY_ITEM_GENERATION_VERSION = 0;
export const ITEM_AFFIX_SEED_LABEL = 'item-affixes';

export type AffixValueKind = 'HUGE_NUMBER' | 'BASIS_POINTS';
export interface AffixDefinition {
  readonly id: string;
  readonly nameKey: string;
  readonly stat: CharacterStatId;
  readonly operation: StatModifierOperation;
  readonly valueKind: AffixValueKind;
  readonly minRoll: number;
  readonly maxRoll: number;
  readonly eligibleSlots: readonly EquipmentSlot[];
  readonly weight: number;
}

const ALL: readonly EquipmentSlot[] = [
  'WEAPON',
  'HELMET',
  'CHEST',
  'GLOVES',
  'BOOTS',
  'RING',
  'AMULET',
];
const OFFENSE: readonly EquipmentSlot[] = ['WEAPON', 'GLOVES', 'RING', 'AMULET'];

/** V1 is immutable once items have been issued. Ranges are inclusive integer units. */
export const AFFIX_CATALOG: readonly AffixDefinition[] = Object.freeze([
  affix('damage_flat', 'DAMAGE', 'FLAT', 'HUGE_NUMBER', 10, 25, [
    'WEAPON',
    'HELMET',
    ...OFFENSE.filter((slot) => slot !== 'WEAPON'),
  ]),
  affix('damage_percent', 'DAMAGE', 'ADDITIVE_PERCENT', 'BASIS_POINTS', 300, 900, [
    'WEAPON',
    'CHEST',
    'GLOVES',
    'BOOTS',
    'RING',
    'AMULET',
  ]),
  affix('max_health_flat', 'MAX_HEALTH', 'FLAT', 'HUGE_NUMBER', 25, 80, ALL),
  affix('max_health_percent', 'MAX_HEALTH', 'ADDITIVE_PERCENT', 'BASIS_POINTS', 300, 900, [
    'HELMET',
    'CHEST',
    'BOOTS',
    'RING',
    'AMULET',
  ]),
  affix('attack_speed_percent', 'ATTACK_SPEED', 'ADDITIVE_PERCENT', 'BASIS_POINTS', 200, 750, [
    'WEAPON',
    'CHEST',
    'GLOVES',
    'BOOTS',
    'RING',
    'AMULET',
  ]),
  affix('critical_chance_flat', 'CRITICAL_CHANCE', 'FLAT', 'BASIS_POINTS', 100, 500, [
    'WEAPON',
    'HELMET',
    'GLOVES',
    'BOOTS',
    'RING',
    'AMULET',
  ]),
  affix(
    'critical_damage_percent',
    'CRITICAL_DAMAGE',
    'ADDITIVE_PERCENT',
    'BASIS_POINTS',
    300,
    1000,
    ['WEAPON', 'HELMET', 'CHEST', 'GLOVES', 'RING', 'AMULET'],
  ),
]);

export const RARITY_AFFIX_BUDGET: Readonly<Record<ItemRarity, number>> = Object.freeze({
  COMMON: 0,
  MAGIC: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
  MYTHIC: 5,
});

function affix(
  id: string,
  stat: CharacterStatId,
  operation: StatModifierOperation,
  valueKind: AffixValueKind,
  minRoll: number,
  maxRoll: number,
  eligibleSlots: readonly EquipmentSlot[],
): AffixDefinition {
  return Object.freeze({
    id,
    nameKey: `affix.${id}.name`,
    stat,
    operation,
    valueKind,
    minRoll,
    maxRoll,
    eligibleSlots: Object.freeze([...eligibleSlots]),
    weight: 1,
  });
}

export interface GeneratedAffix {
  readonly definitionId: string;
  readonly stat: CharacterStatId;
  readonly operation: StatModifierOperation;
  readonly value: string;
  readonly position: number;
}
export interface RolledAffix extends GeneratedAffix {
  readonly id: string;
}

export function generateItemAffixes(input: {
  readonly sourceSeed: string;
  readonly definition: ItemDefinition;
  readonly rarity: ItemRarity;
  readonly generationVersion?: number;
}): readonly GeneratedAffix[] {
  const version = input.generationVersion ?? ITEM_GENERATION_VERSION;
  if (version !== ITEM_GENERATION_VERSION)
    throw new GameCoreError('INVALID_ARGUMENT', `Unsupported item generation version: ${version}.`);
  const count = RARITY_AFFIX_BUDGET[input.rarity];
  const candidates = AFFIX_CATALOG.filter((entry) =>
    entry.eligibleSlots.includes(input.definition.slot),
  );
  if (candidates.length < count)
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Insufficient affix pool for ${input.definition.slot}.`,
    );
  const rng = createRng(
    deriveSeed(
      input.sourceSeed,
      ITEM_AFFIX_SEED_LABEL,
      version,
      input.definition.id.toString(),
      input.rarity,
    ),
  );
  const remaining = [...candidates];
  const rolls: GeneratedAffix[] = [];
  for (let position = 0; position < count; position += 1) {
    const selected = remaining.splice(rng.nextInt(remaining.length), 1)[0];
    if (selected === undefined)
      throw new GameCoreError('INVALID_ARGUMENT', 'Affix selection failed.');
    const rolled = selected.minRoll + rng.nextInt(selected.maxRoll - selected.minRoll + 1);
    rolls.push(
      Object.freeze({
        definitionId: selected.id,
        stat: selected.stat,
        operation: selected.operation,
        value:
          selected.valueKind === 'HUGE_NUMBER'
            ? HugeNumber.fromBigInt(BigInt(rolled)).toString()
            : String(rolled),
        position,
      }),
    );
  }
  return Object.freeze(rolls);
}

export function parseRolledAffix(roll: {
  readonly id: string;
  readonly definitionId: string;
  readonly stat: string;
  readonly operation: string;
  readonly value: string;
  readonly position: number;
}): RolledAffix {
  const definition = AFFIX_CATALOG.find((entry) => entry.id === roll.definitionId);
  if (definition?.stat !== roll.stat || definition.operation !== roll.operation)
    throw new GameCoreError('INVALID_ARGUMENT', 'Invalid persisted affix identity.');
  return validateRolledAffix({
    id: roll.id,
    definitionId: roll.definitionId,
    stat: definition.stat,
    operation: definition.operation,
    value: roll.value,
    position: roll.position,
  });
}

export function validateRolledAffix(roll: RolledAffix): RolledAffix {
  const definition = AFFIX_CATALOG.find((entry) => entry.id === roll.definitionId);
  if (
    definition?.stat !== roll.stat ||
    definition.operation !== roll.operation ||
    !Number.isSafeInteger(roll.position) ||
    roll.position < 0
  )
    throw new GameCoreError('INVALID_ARGUMENT', 'Invalid persisted affix roll.');
  if (definition.valueKind === 'HUGE_NUMBER')
    HugeNumber.parse(roll.value).ensureNonNegative('affix value');
  else if (!/^(?:0|[1-9][0-9]*)$/u.test(roll.value) || !Number.isSafeInteger(Number(roll.value)))
    throw new GameCoreError('INVALID_ARGUMENT', 'Invalid persisted basis-point affix value.');
  return Object.freeze({ ...roll });
}

export function getItemStatModifiers(item: {
  readonly affixes: readonly RolledAffix[];
}): readonly StatModifier[] {
  return Object.freeze(
    item.affixes.map((roll): StatModifier => {
      const definition = AFFIX_CATALOG.find((entry) => entry.id === roll.definitionId);
      if (definition === undefined)
        throw new GameCoreError('INVALID_ARGUMENT', 'Unknown persisted affix definition.');
      const source = { type: 'AFFIX' as const, id: roll.id };
      if (roll.operation === 'ADDITIVE_PERCENT')
        return {
          stat: roll.stat,
          operation: 'ADDITIVE_PERCENT',
          value: Number(roll.value),
          source,
        };
      if (roll.stat === 'MAX_HEALTH' || roll.stat === 'DAMAGE')
        return { stat: roll.stat, operation: 'FLAT', value: HugeNumber.parse(roll.value), source };
      return { stat: roll.stat, operation: 'FLAT', value: Number(roll.value), source };
    }),
  );
}
