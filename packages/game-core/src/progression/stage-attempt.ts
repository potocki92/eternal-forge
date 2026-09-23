import { createCharacter, type Character } from '../character/character.js';
import { simulateCombat, type CombatResult } from '../combat/index.js';
import { createEnemyForStage, type Enemy } from '../enemy/enemy.js';
import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import { calculateStageRewards, NO_REWARDS, type StageRewards } from '../rewards/rewards.js';
import { getGameRules, type GameRules } from '../rules/index.js';
import type { Stage, StageNumber } from '../stage/index.js';
import { applyExperience, experienceToNextLevel, requireWholeAmount } from './level.js';
import { advanceStageProgress, createStageProgress, type StageProgress } from './stage-progress.js';

/**
 * A character's persistent progression: everything a stage attempt reads and
 * writes. Combat stats are not here; they are derived from `level`.
 */
export interface CharacterProgress {
  readonly level: number;
  /** Experience within the current level. */
  readonly experience: HugeNumber;
  readonly gold: HugeNumber;
  /** Where the hero fights next, and the records it has set (ADR-020). */
  readonly stages: StageProgress;
}

export interface StageAttemptInput {
  readonly progress: CharacterProgress;
  /** Server-chosen, never client-supplied (ADR-005, ADR-019). */
  readonly seed: string;
  readonly rulesVersion: number;
}

export interface StageAttemptResult {
  readonly rulesVersion: number;
  readonly seed: string;
  /** The stage actually fought: `before.stages.current`, classified by the rules. */
  readonly stage: Stage;
  readonly enemy: Enemy;
  /** The character as it fought: stats derived from the level before the combat. */
  readonly character: Character;
  readonly combat: CombatResult;
  /** Granted only for a win; {@link NO_REWARDS} otherwise. */
  readonly rewards: StageRewards;
  readonly levelsGained: number;
  readonly before: CharacterProgress;
  readonly after: CharacterProgress;
}

/** What the progression screen shows between combats, derived from source state. */
export interface ProgressDescription {
  /** Experience needed to reach the next level from the current one. */
  readonly experienceToNextLevel: HugeNumber;
  readonly character: Character;
  /**
   * The enemy waiting on the character's current stage, or `null` when the
   * stage lies beyond what the rule set can scale (a HugeNumber `OVERFLOW`,
   * around stage 4·10^10 under `RULES_V1`). The stage itself is still valid
   * (ADR-018); there is simply no enemy the rules can describe there.
   */
  readonly encounter: Enemy | null;
}

function validateProgress(progress: CharacterProgress): CharacterProgress {
  requireWholeAmount(progress.experience, 'experience');
  requireWholeAmount(progress.gold, 'gold');
  createStageProgress(progress.stages);
  return progress;
}

/**
 * One attempt at the character's current stage: the complete, authoritative
 * gameplay step of the first loop (ADR-019).
 *
 * A pure function of `(progress, seed, rulesVersion)`:
 *
 * 1. The enemy is the rule set's enemy for the current stage.
 * 2. The combat is resolved with stats derived from the current level.
 * 3. A win grants the stage rewards and applies the experience through the
 *    level rule.
 * 4. The stage progress moves by {@link advanceStageProgress}: a win clears
 *    the stage and moves on, a loss falls back to farm. The records of the
 *    highest stage reached and cleared never decrease.
 *
 * Callers persist `after` exactly as returned. They never recompute any part
 * of it.
 */
export function resolveStageAttempt(input: StageAttemptInput): StageAttemptResult {
  const rules = getGameRules(input.rulesVersion);
  const before = validateProgress(input.progress);
  const character = createCharacter(before.level, rules);
  const enemy = createEnemyForStage(before.stages.current, rules);
  const combat = simulateCombat({
    player: character,
    enemy,
    seed: input.seed,
    rulesVersion: rules.version,
  });

  const rewards =
    combat.outcome === 'WIN' ? calculateStageRewards(enemy.stage, rules.rewards) : NO_REWARDS;
  const leveled = applyExperience(
    { level: before.level, experience: before.experience },
    rewards.experience,
    rules.progression,
  );

  return {
    rulesVersion: rules.version,
    seed: input.seed,
    stage: enemy.stage,
    enemy,
    character,
    combat,
    rewards,
    levelsGained: leveled.levelsGained,
    before,
    after: {
      level: leveled.level,
      experience: leveled.experience,
      gold: before.gold.add(rewards.gold),
      stages: advanceStageProgress(before.stages, combat.outcome, rules.progression),
    },
  };
}

/** Derived values for displaying `progress` under `rulesVersion`. */
export function describeProgress(
  progress: CharacterProgress,
  rulesVersion: number,
): ProgressDescription {
  const rules: GameRules = getGameRules(rulesVersion);
  validateProgress(progress);
  return {
    experienceToNextLevel: experienceToNextLevel(progress.level, rules.progression),
    character: createCharacter(progress.level, rules),
    encounter: encounterAt(progress.stages.current, rules),
  };
}

function encounterAt(stage: StageNumber, rules: GameRules): Enemy | null {
  try {
    return createEnemyForStage(stage, rules);
  } catch (error) {
    if (error instanceof GameCoreError && error.code === 'OVERFLOW') {
      return null;
    }
    throw error;
  }
}
