import type { HugeNumber } from '../huge-number/index.js';

export type CombatSide = 'PLAYER' | 'ENEMY';

export type CombatOutcome = 'WIN' | 'LOSS';

/**
 * Why the combat ended. `TIME_LIMIT` is a loss: an enemy the player cannot kill
 * in time is a progression wall, whatever the remaining health.
 */
export type CombatEndReason = 'ENEMY_DEFEATED' | 'PLAYER_DEFEATED' | 'TIME_LIMIT';

/**
 * One resolved attack. The ordered event list is what a future CombatScene
 * replays visually. It is a presentation of the result, never an input to it.
 */
export interface CombatEvent {
  readonly timeMs: number;
  readonly attacker: CombatSide;
  readonly critical: boolean;
  readonly damage: HugeNumber;
  /** The defender's health after this hit, never below zero. */
  readonly targetHealth: HugeNumber;
}

export interface CombatantSummary {
  readonly attacks: number;
  readonly criticalHits: number;
  /** Sum of hit damage, including overkill on the final blow. */
  readonly damageDealt: HugeNumber;
  readonly remainingHealth: HugeNumber;
}

/**
 * The complete, deterministic result of one combat.
 *
 * Contains `HugeNumber`s, which serialise to canonical strings, so
 * `JSON.stringify(result)` is a stable fingerprint of the result.
 */
export interface CombatResult {
  readonly rulesVersion: number;
  readonly seed: string;
  readonly outcome: CombatOutcome;
  readonly endReason: CombatEndReason;
  readonly durationMs: number;
  readonly player: CombatantSummary;
  readonly enemy: CombatantSummary;
  readonly events: readonly CombatEvent[];
}
