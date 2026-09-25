import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { BASIS_POINTS } from '../stats/combat-stats.js';
import {
  CHARACTER_CRITICAL_CHANCE_MAX_BP,
  CHARACTER_STAT_IDS,
  CHARACTER_STAT_MINIMUMS,
  type BaseCharacterStats,
  type CharacterStatId,
  type ResolvedCharacterStats,
} from './character-stats.js';
import {
  STAT_MODIFIER_OPERATIONS,
  STAT_MODIFIER_SOURCE_TYPES,
  type StatModifier,
} from './stat-modifier.js';

const BASIS_POINTS_VALUE = HugeNumber.fromNumber(BASIS_POINTS);
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const statRank = new Map(CHARACTER_STAT_IDS.map((value, index) => [value, index]));
const operationRank = new Map(STAT_MODIFIER_OPERATIONS.map((value, index) => [value, index]));
const sourceRank = new Map(STAT_MODIFIER_SOURCE_TYPES.map((value, index) => [value, index]));

function modifierValueKey(modifier: StatModifier): string {
  return typeof modifier.value === 'number'
    ? `${modifier.value < 0 ? '-' : '+'}${String(modifier.value).padStart(16, '0')}`
    : modifier.value.toString();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareModifiers(left: StatModifier, right: StatModifier): number {
  return (
    (statRank.get(left.stat) ?? -1) - (statRank.get(right.stat) ?? -1) ||
    (operationRank.get(left.operation) ?? -1) - (operationRank.get(right.operation) ?? -1) ||
    (sourceRank.get(left.source.type) ?? -1) - (sourceRank.get(right.source.type) ?? -1) ||
    compareStrings(left.source.id, right.source.id) ||
    compareStrings(modifierValueKey(left), modifierValueKey(right))
  );
}

function validateBase(base: BaseCharacterStats): void {
  base.maxHealth.ensureNonNegative('base.maxHealth');
  if (base.maxHealth.isZero()) {
    throw new GameCoreError('INVALID_ARGUMENT', 'base.maxHealth must be positive.');
  }
  base.damage.ensureNonNegative('base.damage');
  for (const [field, value, minimum] of [
    ['attackSpeedBp', base.attackSpeedBp, 1],
    ['criticalChanceBp', base.criticalChanceBp, 0],
    ['criticalDamageBp', base.criticalDamageBp, BASIS_POINTS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new GameCoreError(
        'INVALID_ARGUMENT',
        `base.${field} must be a safe integer of at least ${minimum}.`,
      );
    }
  }
}

function validateModifier(modifier: StatModifier): void {
  if (!statRank.has(modifier.stat) || !operationRank.has(modifier.operation)) {
    throw new GameCoreError('INVALID_ARGUMENT', 'Unknown stat modifier identifier or operation.');
  }
  if (!sourceRank.has(modifier.source.type) || !SOURCE_ID_PATTERN.test(modifier.source.id)) {
    throw new GameCoreError('INVALID_ARGUMENT', 'Stat modifier source is not canonical.');
  }
  if (modifier.operation === 'ADDITIVE_PERCENT' || typeof modifier.value === 'number') {
    if (!Number.isSafeInteger(modifier.value)) {
      throw new GameCoreError(
        'INVALID_ARGUMENT',
        'Basis-point modifier values must be safe integers.',
      );
    }
  }
  if (
    modifier.operation === 'FLAT' &&
    (modifier.stat === 'MAX_HEALTH' || modifier.stat === 'DAMAGE') &&
    !(modifier.value instanceof HugeNumber)
  ) {
    throw new GameCoreError('INVALID_ARGUMENT', 'Large flat modifiers must use HugeNumber.');
  }
}

function modifiersFor(stat: CharacterStatId, modifiers: readonly StatModifier[]): StatModifier[] {
  return modifiers.filter((modifier) => modifier.stat === stat).sort(compareModifiers);
}

function resolveHuge(
  base: HugeNumber,
  stat: 'MAX_HEALTH' | 'DAMAGE',
  modifiers: readonly StatModifier[],
  minimum: HugeNumber,
): HugeNumber {
  let subtotal = base;
  let percent = 0n;
  for (const modifier of modifiersFor(stat, modifiers)) {
    if (modifier.operation === 'FLAT') {
      if (typeof modifier.value === 'number') {
        throw new GameCoreError('INVALID_ARGUMENT', `${stat} flat modifiers must use HugeNumber.`);
      }
      subtotal = subtotal.add(modifier.value);
    } else {
      percent += BigInt(modifier.value);
    }
  }
  const factor = BigInt(BASIS_POINTS) + percent;
  const resolved =
    factor <= 0n
      ? HugeNumber.ZERO
      : subtotal.mul(HugeNumber.fromBigInt(factor)).div(BASIS_POINTS_VALUE);
  return HugeNumber.max(resolved, minimum);
}

function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const twiceRemainder = (magnitude % denominator) * 2n;
  const rounded =
    twiceRemainder > denominator || (twiceRemainder === denominator && (quotient & 1n) === 1n)
      ? quotient + 1n
      : quotient;
  return negative ? -rounded : rounded;
}

function resolveRate(
  base: number,
  stat: 'ATTACK_SPEED' | 'CRITICAL_CHANCE' | 'CRITICAL_DAMAGE',
  modifiers: readonly StatModifier[],
  minimum: number,
  maximum?: number,
): number {
  let subtotal = BigInt(base);
  let percent = 0n;
  for (const modifier of modifiersFor(stat, modifiers)) {
    if (modifier.operation === 'FLAT') {
      if (typeof modifier.value !== 'number') {
        throw new GameCoreError(
          'INVALID_ARGUMENT',
          `${stat} flat modifiers must use basis points.`,
        );
      }
      subtotal += BigInt(modifier.value);
    } else {
      percent += BigInt(modifier.value);
    }
  }
  const factor = BigInt(BASIS_POINTS) + percent;
  let resolved = factor <= 0n ? 0n : divideRoundHalfEven(subtotal * factor, BigInt(BASIS_POINTS));
  resolved = resolved < BigInt(minimum) ? BigInt(minimum) : resolved;
  if (maximum !== undefined && resolved > BigInt(maximum)) resolved = BigInt(maximum);
  if (resolved > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GameCoreError('OUT_OF_RANGE', `${stat} exceeds the safe integer range.`);
  }
  return Number(resolved);
}

/**
 * Resolves BASE -> FLAT -> ADDITIVE_PERCENT -> CLAMP without mutating inputs.
 * Modifiers are canonically sorted, so equivalent multisets resolve equally.
 * Integer rate division and HugeNumber arithmetic both round half-to-even.
 */
export function resolveCharacterStats(
  base: BaseCharacterStats,
  modifiers: readonly StatModifier[],
): ResolvedCharacterStats {
  validateBase(base);
  for (const modifier of modifiers) validateModifier(modifier);

  return {
    maxHealth: resolveHuge(
      base.maxHealth,
      'MAX_HEALTH',
      modifiers,
      CHARACTER_STAT_MINIMUMS.maxHealth,
    ),
    damage: resolveHuge(base.damage, 'DAMAGE', modifiers, CHARACTER_STAT_MINIMUMS.damage),
    attackSpeedBp: resolveRate(
      base.attackSpeedBp,
      'ATTACK_SPEED',
      modifiers,
      CHARACTER_STAT_MINIMUMS.attackSpeedBp,
    ),
    criticalChanceBp: resolveRate(
      base.criticalChanceBp,
      'CRITICAL_CHANCE',
      modifiers,
      CHARACTER_STAT_MINIMUMS.criticalChanceBp,
      CHARACTER_CRITICAL_CHANCE_MAX_BP,
    ),
    criticalDamageBp: resolveRate(
      base.criticalDamageBp,
      'CRITICAL_DAMAGE',
      modifiers,
      CHARACTER_STAT_MINIMUMS.criticalDamageBp,
    ),
  };
}
