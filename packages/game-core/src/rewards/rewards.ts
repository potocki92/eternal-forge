import { HugeNumber } from '../huge-number/index.js';
import type { RewardRules } from '../rules/index.js';
import { scaleByStage, type Stage } from '../stage/index.js';

/** Resources granted for clearing a stage. Whole, non-negative amounts. */
export interface StageRewards {
  readonly gold: HugeNumber;
  readonly experience: HugeNumber;
}

export const NO_REWARDS: StageRewards = Object.freeze({
  gold: HugeNumber.ZERO,
  experience: HugeNumber.ZERO,
});

/**
 * Rewards for clearing `stage`: `floor(base × growth^(stage − 1) × boss)`.
 *
 * Game Core computes the amount; granting it is a server-side, transactional
 * operation (docs/SECURITY.md — "Economy") that later phases implement.
 */
export function calculateStageRewards(stage: Stage, rules: RewardRules): StageRewards {
  const multiplier = stage.kind === 'BOSS' ? rules.bossRewardMultiplier : HugeNumber.ONE;
  return {
    gold: scaleByStage(rules.baseGold, rules.goldGrowth, stage).mul(multiplier).floor(),
    experience: scaleByStage(rules.baseExperience, rules.experienceGrowth, stage)
      .mul(multiplier)
      .floor(),
  };
}

export function addRewards(first: StageRewards, second: StageRewards): StageRewards {
  return {
    gold: first.gold.add(second.gold),
    experience: first.experience.add(second.experience),
  };
}
