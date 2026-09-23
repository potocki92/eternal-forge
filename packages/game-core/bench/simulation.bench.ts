import { bench, describe } from 'vitest';
import {
  GAME_RULES_VERSION,
  StageNumber,
  createCharacter,
  createEnemyForStage,
  getGameRules,
  HugeNumber,
  resolveOfflineProgress,
  simulateCombat,
  simulateStages,
  type CharacterProgress,
  type CombatResult,
  type OfflineProgressResult,
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
const regularEnemy = createEnemyForStage(StageNumber.of(21), rules);
const bossEnemy = createEnemyForStage(StageNumber.of(30), rules);

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

let offline: OfflineProgressResult | undefined;

/** A hero pushing stage `stage + 1`, farming `stage` offline (ADR-023). */
function farming(level: number, stage: bigint): CharacterProgress {
  return {
    level,
    experience: HugeNumber.ZERO,
    gold: HugeNumber.ZERO,
    stages: {
      current: StageNumber.of(stage + 1n),
      highestReached: StageNumber.of(stage + 1n),
      highestCleared: StageNumber.of(stage),
    },
  };
}

describe('resolveOfflineProgress', () => {
  for (const [label, level, stage, elapsedMs] of [
    ['5 minutes, stage 9', 10, 9n, 5 * 60_000],
    ['1 hour, stage 9', 10, 9n, 3_600_000],
    ['8 hours (cap), stage 9', 10, 9n, 8 * 3_600_000],
    ['8 hours (cap), stage 1 000 — 28 800 fights', 2_000, 1_000n, 8 * 3_600_000],
  ] as const) {
    bench(label, () => {
      offline = resolveOfflineProgress({
        progress: farming(level, stage),
        elapsedMs,
        seed: 'bench',
        rulesVersion: GAME_RULES_VERSION,
      });
    });
  }
});

export const observed = (): readonly [
  CombatResult | undefined,
  StageRunResult | undefined,
  OfflineProgressResult | undefined,
] => [combat, run, offline];
