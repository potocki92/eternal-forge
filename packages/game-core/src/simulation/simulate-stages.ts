import type { Character } from '../character/character.js';
import type { CombatEndReason, CombatOutcome } from '../combat/index.js';
import { simulateCombat } from '../combat/index.js';
import { createEnemyForStage } from '../enemy/enemy.js';
import { GameCoreError } from '../errors.js';
import {
  addRewards,
  calculateStageRewards,
  NO_REWARDS,
  type StageRewards,
} from '../rewards/rewards.js';
import { deriveSeed } from '../rng/index.js';
import { getGameRules } from '../rules/index.js';
import { StageNumber, type Stage } from '../stage/index.js';

/** Upper bound on one call, so a request can never ask for unbounded work. */
export const MAX_STAGES_PER_SIMULATION = 10_000;

export interface SimulateStagesInput {
  readonly character: Character;
  /** Root seed of the run. Each stage uses `deriveSeed(seed, 'stage', n)`. */
  readonly seed: string;
  readonly rulesVersion: number;
  /** First stage to fight. Defaults to {@link StageNumber.FIRST}. */
  readonly startStage?: StageNumber;
  /** Maximum number of stages to fight, 1 to `MAX_STAGES_PER_SIMULATION`. */
  readonly maxStages: number;
}

export interface StageRunEntry {
  readonly stage: Stage;
  readonly enemyArchetypeId: string;
  readonly outcome: CombatOutcome;
  readonly endReason: CombatEndReason;
  readonly durationMs: number;
  /** Granted only for a win; `NO_REWARDS` otherwise. */
  readonly rewards: StageRewards;
}

export type StageRunStopReason = 'DEFEATED' | 'STAGE_LIMIT';

export interface StageRunResult {
  readonly rulesVersion: number;
  readonly seed: string;
  readonly startStage: StageNumber;
  readonly stages: readonly StageRunEntry[];
  /** Highest stage won in this run, or `null` if the first stage was lost. */
  readonly highestStageCleared: StageNumber | null;
  readonly totalRewards: StageRewards;
  readonly stopReason: StageRunStopReason;
}

/**
 * Headless stage progression: fights stage after stage until the character
 * loses or `maxStages` have been fought.
 *
 * Every stage is an independent combat at full health with its own derived
 * seed. So a stage's result depends only on `(character, stage, seed,
 * rulesVersion)`, not on how many stages preceded it in the call, and two
 * overlapping runs agree on the stages they share. Phase 1 keeps the character
 * fixed during the run: spending rewards is a player decision, taken by later
 * phases through server-side commands.
 */
export function simulateStages(input: SimulateStagesInput): StageRunResult {
  const rules = getGameRules(input.rulesVersion);
  const startStage = input.startStage ?? StageNumber.FIRST;
  if (
    !Number.isSafeInteger(input.maxStages) ||
    input.maxStages < 1 ||
    input.maxStages > MAX_STAGES_PER_SIMULATION
  ) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `maxStages must be an integer from 1 to ${MAX_STAGES_PER_SIMULATION}.`,
    );
  }
  // Refuses a range that would run past the last stage before fighting any.
  startStage.plus(input.maxStages - 1);

  const stages: StageRunEntry[] = [];
  let totalRewards = NO_REWARDS;
  let highestStageCleared: StageNumber | null = null;

  for (let offset = 0; offset < input.maxStages; offset += 1) {
    const enemy = createEnemyForStage(startStage.plus(offset), rules);
    const combat = simulateCombat({
      player: input.character,
      enemy,
      // The decimal string is the label a numeric stage always produced, so
      // every seed — and every recorded result — is unchanged (ADR-018).
      seed: deriveSeed(input.seed, 'stage', enemy.stage.number.toString()),
      rulesVersion: rules.version,
    });
    const rewards =
      combat.outcome === 'WIN' ? calculateStageRewards(enemy.stage, rules.rewards) : NO_REWARDS;

    stages.push({
      stage: enemy.stage,
      enemyArchetypeId: enemy.archetypeId,
      outcome: combat.outcome,
      endReason: combat.endReason,
      durationMs: combat.durationMs,
      rewards,
    });

    if (combat.outcome === 'LOSS') {
      return {
        rulesVersion: rules.version,
        seed: input.seed,
        startStage,
        stages,
        highestStageCleared,
        totalRewards,
        stopReason: 'DEFEATED',
      };
    }
    highestStageCleared = enemy.stage.number;
    totalRewards = addRewards(totalRewards, rewards);
  }

  return {
    rulesVersion: rules.version,
    seed: input.seed,
    startStage,
    stages,
    highestStageCleared,
    totalRewards,
    stopReason: 'STAGE_LIMIT',
  };
}
