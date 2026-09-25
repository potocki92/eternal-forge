import type { HugeNumber } from '../huge-number/index.js';
import type { CharacterStatId } from './character-stats.js';

export const STAT_MODIFIER_OPERATIONS = ['FLAT', 'ADDITIVE_PERCENT'] as const;
export type StatModifierOperation = (typeof STAT_MODIFIER_OPERATIONS)[number];

export const STAT_MODIFIER_SOURCE_TYPES = [
  'ITEM_INSTANCE',
  'AFFIX',
  'SKILL',
  'BUFF',
  'DEBUFF',
  'PASSIVE',
] as const;
export type StatModifierSourceType = (typeof STAT_MODIFIER_SOURCE_TYPES)[number];

/** Trace metadata; resolver mathematics never branches on the source type. */
export interface StatModifierSource {
  readonly type: StatModifierSourceType;
  /** Stable identity within the source type, used for diagnostics and ordering. */
  readonly id: string;
}

interface ModifierCommon {
  readonly source: StatModifierSource;
}

export interface HugeFlatStatModifier extends ModifierCommon {
  readonly stat: 'MAX_HEALTH' | 'DAMAGE';
  readonly operation: 'FLAT';
  readonly value: HugeNumber;
}

export interface RateFlatStatModifier extends ModifierCommon {
  readonly stat: 'ATTACK_SPEED' | 'CRITICAL_CHANCE' | 'CRITICAL_DAMAGE';
  readonly operation: 'FLAT';
  /** Basis-point delta. */
  readonly value: number;
}

export interface AdditivePercentStatModifier extends ModifierCommon {
  readonly stat: CharacterStatId;
  readonly operation: 'ADDITIVE_PERCENT';
  /** Basis points applied to the base-plus-flat subtotal; 1,000 = +10%. */
  readonly value: number;
}

export type StatModifier =
  HugeFlatStatModifier | RateFlatStatModifier | AdditivePercentStatModifier;
