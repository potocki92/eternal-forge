import { GameCoreError } from '../errors.js';
import type { StageRules } from '../rules/index.js';

export type StageKind = 'REGULAR' | 'BOSS';

/**
 * A position on the unbounded stage ladder.
 *
 * Stage numbers are safe integers starting at 1. They are not `HugeNumber`s:
 * ADR-013 notes that Highest Stage stays within integer range, and a player
 * clearing one stage per second would need ~285 million years to exhaust it.
 */
export interface Stage {
  readonly number: number;
  readonly kind: StageKind;
}

export function validateStageNumber(stageNumber: number): number {
  if (!Number.isSafeInteger(stageNumber) || stageNumber < 1) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      'Stage number must be a safe integer of at least 1.',
    );
  }
  return stageNumber;
}

export function resolveStage(stageNumber: number, rules: StageRules): Stage {
  validateStageNumber(stageNumber);
  return {
    number: stageNumber,
    kind: stageNumber % rules.bossInterval === 0 ? 'BOSS' : 'REGULAR',
  };
}
