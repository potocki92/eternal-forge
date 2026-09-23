import {
  GAME_RULES_VERSION,
  describeProgress,
  type ProgressDescription,
  type StageMode,
  type StageProgress,
} from '@eternal-forge/game-core';
import { progressOf, type Character } from './player.js';

/**
 * What a client needs to display a character between combats, all of it
 * derived by Game Core from source state under the current rules
 * (ADR-019): the experience requirement, the hero's stats and the enemy
 * waiting on the current stage — together with the stage progress itself
 * (ADR-020).
 */
export interface ProgressionView extends ProgressDescription {
  readonly stages: StageProgress;
  /** Climbing or farming (ADR-021). */
  readonly stageMode: StageMode;
  readonly nextCombatAt: Date;
}

export function viewProgression(
  character: Character,
  rulesVersion: number = GAME_RULES_VERSION,
): ProgressionView {
  return {
    ...describeProgress(progressOf(character), rulesVersion),
    stages: character.stages,
    stageMode: character.stageMode,
    nextCombatAt: character.nextCombatAt,
  };
}
