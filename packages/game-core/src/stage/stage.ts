import type { StageRules } from '../rules/index.js';
import type { StageNumber } from './stage-number.js';

export type StageKind = 'REGULAR' | 'BOSS';

/**
 * A position on the stage ladder, classified by the rule set.
 *
 * The number is a {@link StageNumber}, exact up to the PostgreSQL `bigint`
 * ceiling (ADR-018). It is not a `HugeNumber`: a stage is a discrete counter.
 */
export interface Stage {
  readonly number: StageNumber;
  readonly kind: StageKind;
}

export function resolveStage(stageNumber: StageNumber, rules: StageRules): Stage {
  return {
    number: stageNumber,
    kind: stageNumber.isMultipleOf(rules.bossInterval) ? 'BOSS' : 'REGULAR',
  };
}
