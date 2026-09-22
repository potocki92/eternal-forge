import { HugeNumber } from '../huge-number/index.js';
import { createRng } from '../rng/index.js';
import { getGameRules } from '../rules/index.js';
import type { CombatRules } from '../rules/index.js';
import { applyCombatCaps, validateCombatStats, type CombatStats } from '../stats/combat-stats.js';
import { attackTimeMs, landsNoLaterThan, landsWithin } from './attack-timeline.js';
import type {
  CombatEndReason,
  CombatEvent,
  CombatResult,
  CombatSide,
  CombatantSummary,
} from './combat-result.js';
import { calculateHitDamage } from './damage.js';

/** Anything that can fight: a character, an enemy, later a companion or a snapshot. */
export interface Combatant {
  readonly stats: CombatStats;
}

export interface SimulateCombatInput {
  readonly player: Combatant;
  readonly enemy: Combatant;
  /** Server-chosen seed (ADR-005). Never accepted from a client. */
  readonly seed: string;
  /** The rule set to resolve under; recorded in the result for replay. */
  readonly rulesVersion: number;
}

interface Fighter {
  readonly side: CombatSide;
  readonly stats: CombatStats;
  health: HugeNumber;
  attacks: number;
  criticalHits: number;
  damageDealt: HugeNumber;
}

function createFighter(side: CombatSide, stats: CombatStats, rules: CombatRules): Fighter {
  const capped = applyCombatCaps(validateCombatStats(stats, side.toLowerCase()), rules);
  return {
    side,
    stats: capped,
    health: capped.maxHealth,
    attacks: 0,
    criticalHits: 0,
    damageDealt: HugeNumber.ZERO,
  };
}

function summarise(fighter: Fighter): CombatantSummary {
  return {
    attacks: fighter.attacks,
    criticalHits: fighter.criticalHits,
    damageDealt: fighter.damageDealt,
    remainingHealth: fighter.health,
  };
}

/**
 * Resolves one combat between the player and an enemy.
 *
 * A pure function of `(player, enemy, seed, rulesVersion)`: no I/O, no clock,
 * no ambient randomness. Rules, in order of application:
 *
 * 1. Both sides start at full health and attack automatically. A side's
 *    `k`-th attack lands at `k / attacksPerSecond` seconds, computed exactly.
 * 2. Attacks landing at the same instant resolve player first.
 * 3. Each attack draws exactly one RNG value to decide a critical hit.
 * 4. A hit reduces the defender's health, not below zero. The combat ends the
 *    moment one side reaches zero.
 * 5. No attack lands after the rule set's time limit. A combat still undecided
 *    then is a `LOSS` with reason `TIME_LIMIT`.
 */
export function simulateCombat(input: SimulateCombatInput): CombatResult {
  const rules = getGameRules(input.rulesVersion);
  const player = createFighter('PLAYER', input.player.stats, rules.combat);
  const enemy = createFighter('ENEMY', input.enemy.stats, rules.combat);
  const rng = createRng(input.seed);
  const events: CombatEvent[] = [];

  const finish = (endReason: CombatEndReason, durationMs: number): CombatResult => ({
    rulesVersion: rules.version,
    seed: input.seed,
    outcome: endReason === 'ENEMY_DEFEATED' ? 'WIN' : 'LOSS',
    endReason,
    durationMs,
    player: summarise(player),
    enemy: summarise(enemy),
    events,
  });

  // Terminates: every iteration advances one side's attack index, and the time
  // limit caps each index at timeLimit × maxAttackSpeed.
  for (;;) {
    const playerActsFirst = landsNoLaterThan(
      player.attacks + 1,
      player.stats.attackSpeedBp,
      enemy.attacks + 1,
      enemy.stats.attackSpeedBp,
    );
    const attacker = playerActsFirst ? player : enemy;
    const defender = playerActsFirst ? enemy : player;
    const attackIndex = attacker.attacks + 1;

    if (!landsWithin(attackIndex, attacker.stats.attackSpeedBp, rules.combat.timeLimitMs)) {
      return finish('TIME_LIMIT', rules.combat.timeLimitMs);
    }

    const critical = rng.chance(attacker.stats.critChanceBp);
    const damage = calculateHitDamage(attacker.stats, critical);
    const remaining = defender.health.sub(damage);

    attacker.attacks = attackIndex;
    attacker.criticalHits += critical ? 1 : 0;
    attacker.damageDealt = attacker.damageDealt.add(damage);
    defender.health = remaining.isNegative() ? HugeNumber.ZERO : remaining;

    const timeMs = attackTimeMs(attackIndex, attacker.stats.attackSpeedBp);
    events.push({
      timeMs,
      attacker: attacker.side,
      critical,
      damage,
      targetHealth: defender.health,
    });

    if (defender.health.isZero()) {
      return finish(defender === enemy ? 'ENEMY_DEFEATED' : 'PLAYER_DEFEATED', timeMs);
    }
  }
}
