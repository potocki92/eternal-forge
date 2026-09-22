import { HugeNumber } from '../huge-number/index.js';
import { BASIS_POINTS, type CombatStats } from '../stats/combat-stats.js';

const BASIS_POINTS_VALUE = HugeNumber.fromNumber(BASIS_POINTS);

/**
 * Damage of one hit.
 *
 * Normal hit: `damage`. Critical hit: `damage × critDamageBp / 10 000`.
 * Armor, resistances and effects arrive with later phases and extend this
 * function; they do not bypass it.
 */
export function calculateHitDamage(attacker: CombatStats, critical: boolean): HugeNumber {
  if (!critical) {
    return attacker.damage;
  }
  return attacker.damage.mul(HugeNumber.fromNumber(attacker.critDamageBp)).div(BASIS_POINTS_VALUE);
}
