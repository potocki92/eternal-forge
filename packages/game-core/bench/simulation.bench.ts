import { bench, describe } from 'vitest';
import {
  GAME_RULES_VERSION,
  createCharacter,
  createEnemyForStage,
  getGameRules,
  simulateCombat,
  simulateStages,
  type CombatResult,
  type StageRunResult,
} from '../src/index.js';

/**
 * Combat and stage-simulation benchmarks.
 *
 *   pnpm --filter @eternal-forge/game-core run bench
 *
 * Not part of `pnpm test` and not run in CI (see huge-number.bench.ts).
 */

const rules = getGameRules(GAME_RULES_VERSION);
const character = createCharacter(20, rules);
const regularEnemy = createEnemyForStage(21, rules);
const bossEnemy = createEnemyForStage(30, rules);

let combat: CombatResult | undefined;
let run: StageRunResult | undefined;

describe('simulateCombat', () => {
  bench('regular stage (character level 20 vs stage 21)', () => {
    combat = simulateCombat({
      player: character,
      enemy: regularEnemy,
      seed: 'bench',
      rulesVersion: GAME_RULES_VERSION,
    });
  });
  bench('boss stage to the time limit or a defeat (level 20 vs stage 30)', () => {
    combat = simulateCombat({
      player: character,
      enemy: bossEnemy,
      seed: 'bench',
      rulesVersion: GAME_RULES_VERSION,
    });
  });
});

describe('simulateStages', () => {
  bench('100 stages (level 500, stages 1–100)', () => {
    run = simulateStages({
      character: createCharacter(500, rules),
      seed: 'bench',
      rulesVersion: GAME_RULES_VERSION,
      maxStages: 100,
    });
  });
});

export const observed = (): readonly [CombatResult | undefined, StageRunResult | undefined] => [
  combat,
  run,
];
