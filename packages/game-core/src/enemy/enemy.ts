import type { GameRules } from '../rules/index.js';
import {
  archetypeForStage,
  enemyStatsForStage,
  resolveStage,
  type Stage,
  type StageNumber,
} from '../stage/index.js';
import type { CombatStats } from '../stats/combat-stats.js';

/** An enemy instance: archetype data scaled to a stage. */
export interface Enemy {
  readonly archetypeId: string;
  readonly stage: Stage;
  readonly stats: CombatStats;
}

export function createEnemyForStage(stageNumber: StageNumber, rules: GameRules): Enemy {
  const stage = resolveStage(stageNumber, rules.stages);
  return {
    archetypeId: archetypeForStage(stage, rules.stages).id,
    stage,
    stats: enemyStatsForStage(stage, rules.stages),
  };
}
