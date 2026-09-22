import { BASIS_POINTS } from '../stats/combat-stats.js';

/**
 * Exact attack timing without floating point.
 *
 * With attack speed `s` (basis points of attacks per second), a combatant's
 * `k`-th attack lands at `k × 10 000 / s` seconds. The engine never rounds this
 * time to decide ordering. Two attack times are compared by cross-multiplying,
 * and the millisecond value reported in results is derived afterwards, by
 * integer division.
 *
 * All products stay far below 2^53: `k` is bounded by the combat time limit and
 * `s` by the attack-speed cap.
 */

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECOND_NUMERATOR = BASIS_POINTS * MILLISECONDS_PER_SECOND;

/**
 * Whether attack `attackIndexA` at speed `speedA` lands no later than attack
 * `attackIndexB` at speed `speedB`.
 */
export function landsNoLaterThan(
  attackIndexA: number,
  speedA: number,
  attackIndexB: number,
  speedB: number,
): boolean {
  return attackIndexA * speedB <= attackIndexB * speedA;
}

/** Whether attack `attackIndex` at `speed` lands within `limitMs`. */
export function landsWithin(attackIndex: number, speed: number, limitMs: number): boolean {
  return attackIndex * MILLISECOND_NUMERATOR <= limitMs * speed;
}

/** The landing time of attack `attackIndex`, floored to whole milliseconds. */
export function attackTimeMs(attackIndex: number, speed: number): number {
  const numerator = attackIndex * MILLISECOND_NUMERATOR;
  return (numerator - (numerator % speed)) / speed;
}
