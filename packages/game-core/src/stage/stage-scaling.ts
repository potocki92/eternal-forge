import type { HugeNumber } from '../huge-number/index.js';
import type { EnemyArchetype, StageRules } from '../rules/index.js';
import type { CombatStats } from '../stats/combat-stats.js';
import type { Stage } from './stage.js';

/**
 * The single place stage scaling is computed (docs/GAME_DESIGN.md — "Enemy
 * scaling must be centralized").
 *
 * `value(stage) = base × growth^(stage − 1)`. The power uses HugeNumber's
 * square-and-multiply on the exact `bigint` exponent, so stage 1 000 000 costs
 * about 20 multiplications and every result is deterministic. A stage too deep
 * for the rule set's growth fails with a HugeNumber `OVERFLOW`, never a wrong
 * value.
 */
export function scaleByStage(base: HugeNumber, growth: HugeNumber, stage: Stage): HugeNumber {
  return base.mul(growth.pow(stage.number.stagesBefore()));
}

export function archetypeForStage(stage: Stage, rules: StageRules): EnemyArchetype {
  return stage.kind === 'BOSS' ? rules.bossArchetype : rules.regularArchetype;
}

/** Combat stats of the enemy defending `stage`. */
export function enemyStatsForStage(stage: Stage, rules: StageRules): CombatStats {
  const archetype = archetypeForStage(stage, rules);
  return {
    maxHealth: scaleByStage(rules.baseEnemyHealth, rules.enemyHealthGrowth, stage).mul(
      archetype.healthMultiplier,
    ),
    damage: scaleByStage(rules.baseEnemyDamage, rules.enemyDamageGrowth, stage).mul(
      archetype.damageMultiplier,
    ),
    attackSpeedBp: archetype.attackSpeedBp,
    critChanceBp: archetype.critChanceBp,
    critDamageBp: archetype.critDamageBp,
  };
}
