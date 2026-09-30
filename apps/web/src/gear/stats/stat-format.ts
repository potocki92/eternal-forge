import type {
  CharacterStatDeltaDto,
  CharacterStatIdDto,
  CharacterStatValuesDto,
} from '@eternal-forge/contracts';
import { formatHuge } from '../../game/format/format-huge';

/**
 * Presentation of server-resolved character stats (ADR-030).
 *
 * Nothing here computes a stat, a delta or a cap: every number arrives from
 * the API and is only turned into text. Rates stay integers — basis points
 * are exact decimals, so they are formatted with integer arithmetic and never
 * pass through a float. Health and damage use the shared HugeNumber
 * formatter, which reads exact digits at any magnitude.
 */

/** Build-panel order: offence first, then survival, then rhythm and criticals. */
export const STAT_ORDER: readonly CharacterStatIdDto[] = [
  'DAMAGE',
  'MAX_HEALTH',
  'ATTACK_SPEED',
  'CRITICAL_CHANCE',
  'CRITICAL_DAMAGE',
];

export const STAT_LABEL: Readonly<Record<CharacterStatIdDto, string>> = {
  MAX_HEALTH: 'Max Health',
  DAMAGE: 'Damage',
  ATTACK_SPEED: 'Attack Speed',
  CRITICAL_CHANCE: 'Critical Chance',
  CRITICAL_DAMAGE: 'Critical Damage',
};

type ValueField = keyof CharacterStatValuesDto;
const FIELD: Readonly<Record<CharacterStatIdDto, ValueField>> = {
  MAX_HEALTH: 'maxHealth',
  DAMAGE: 'damage',
  ATTACK_SPEED: 'attackSpeedBp',
  CRITICAL_CHANCE: 'criticalChanceBp',
  CRITICAL_DAMAGE: 'criticalDamageBp',
};

/**
 * Whether a larger value helps the player. Explicit per stat on purpose: all
 * five current stats are "more is better", but a future stat (a cooldown, an
 * incoming-damage multiplier) will not be, and must make its own choice here
 * rather than inherit an assumption.
 */
const HIGHER_IS_BETTER: Readonly<Record<CharacterStatIdDto, boolean>> = {
  MAX_HEALTH: true,
  DAMAGE: true,
  ATTACK_SPEED: true,
  CRITICAL_CHANCE: true,
  CRITICAL_DAMAGE: true,
};

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * An exact decimal of an integer: `units / divisor` with between
 * `minDecimals` and all of the divisor's digits after the point.
 */
function exactDecimal(units: number, divisor: 100 | 10_000, minDecimals: number): string {
  const magnitude = Math.abs(units);
  const whole = Math.trunc(magnitude / divisor);
  const places = divisor === 100 ? 2 : 4;
  let fraction = String(magnitude % divisor).padStart(places, '0');
  while (fraction.length > minDecimals && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }
  return fraction === '' ? GROUPED.format(whole) : `${GROUPED.format(whole)}.${fraction}`;
}

/** Attacks per second: 10,000 bp = 1 attack per second, so 12,500 → `1.25 / sec`. */
export function formatAttackSpeed(bp: number): string {
  return `${exactDecimal(bp, 10_000, 2)} / sec`;
}

/** A basis-point percentage: 1,435 → `14.35%`; critical damage 15,000 → `150.00%` (total). */
export function formatPercent(bp: number): string {
  return `${exactDecimal(bp, 100, 2)}%`;
}

function formatMagnitude(stat: CharacterStatIdDto, value: string | number): string {
  switch (stat) {
    case 'MAX_HEALTH':
    case 'DAMAGE':
      return formatHuge(String(value));
    case 'ATTACK_SPEED':
      return formatAttackSpeed(Number(value));
    case 'CRITICAL_CHANCE':
    case 'CRITICAL_DAMAGE':
      return formatPercent(Number(value));
  }
}

export function statValue(values: CharacterStatValuesDto, stat: CharacterStatIdDto) {
  return values[FIELD[stat]];
}

/** The player-facing value of one stat: `143`, `1.27 / sec`, `14.35%`, `168.00%`. */
export function formatStat(values: CharacterStatValuesDto, stat: CharacterStatIdDto): string {
  return formatMagnitude(stat, statValue(values, stat));
}

type Sign = -1 | 0 | 1;

function deltaSign(delta: CharacterStatDeltaDto, stat: CharacterStatIdDto): Sign {
  const value = delta[FIELD[stat]];
  if (typeof value === 'number') return value > 0 ? 1 : value < 0 ? -1 : 0;
  // Canonical HugeNumber strings: zero is exactly "0", negatives start with "-".
  return value === '0' ? 0 : value.startsWith('-') ? -1 : 1;
}

function deltaMagnitude(delta: CharacterStatDeltaDto, stat: CharacterStatIdDto): string {
  const value = delta[FIELD[stat]];
  return formatMagnitude(
    stat,
    typeof value === 'number' ? Math.abs(value) : value.replace(/^-/u, ''),
  );
}

/** Which way the number moves, independent of whether that helps. */
export function deltaDirection(
  delta: CharacterStatDeltaDto,
  stat: CharacterStatIdDto,
): 'up' | 'down' | 'none' {
  const sign = deltaSign(delta, stat);
  return sign > 0 ? 'up' : sign < 0 ? 'down' : 'none';
}

export function isUnchanged(delta: CharacterStatDeltaDto, stat: CharacterStatIdDto): boolean {
  return deltaSign(delta, stat) === 0;
}

/** Signed change with its unit: `+18`, `-30`, `+3.70%`, `+0.12 / sec`. */
export function formatStatDelta(delta: CharacterStatDeltaDto, stat: CharacterStatIdDto): string {
  const sign = deltaSign(delta, stat);
  return `${sign < 0 ? '-' : '+'}${deltaMagnitude(delta, stat)}`;
}

/** Whether a change helps (`gain`), hurts (`loss`) or does nothing, for this stat. */
export function deltaTone(
  delta: CharacterStatDeltaDto,
  stat: CharacterStatIdDto,
): 'gain' | 'loss' | 'none' {
  const sign = deltaSign(delta, stat);
  if (sign === 0) return 'none';
  return sign > 0 === HIGHER_IS_BETTER[stat] ? 'gain' : 'loss';
}

/** A sentence for assistive technology: "Damage increases by 18". */
export function describeStatDelta(delta: CharacterStatDeltaDto, stat: CharacterStatIdDto): string {
  const sign = deltaSign(delta, stat);
  if (sign === 0) return `${STAT_LABEL[stat]} does not change`;
  return `${STAT_LABEL[stat]} ${sign > 0 ? 'increases' : 'decreases'} by ${deltaMagnitude(delta, stat)}`;
}
