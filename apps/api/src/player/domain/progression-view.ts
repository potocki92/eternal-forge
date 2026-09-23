import {
  GAME_RULES_VERSION,
  describeProgress,
  type ProgressDescription,
} from '@eternal-forge/game-core';
import { progressOf, type Character } from './player.js';

/**
 * What a client needs to display a character between combats, all of it
 * derived by Game Core from source state under the current rules
 * (ADR-019): the experience requirement, the hero's stats and the enemy
 * waiting on the current stage.
 */
export interface ProgressionView extends ProgressDescription {
  readonly nextCombatAt: Date;
}

export function viewProgression(
  character: Character,
  rulesVersion: number = GAME_RULES_VERSION,
): ProgressionView {
  return {
    ...describeProgress(progressOf(character), rulesVersion),
    nextCombatAt: character.nextCombatAt,
  };
}
