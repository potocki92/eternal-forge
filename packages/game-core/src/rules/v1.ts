import { HugeNumber } from '../huge-number/index.js';
import type { GameRules } from './game-rules.js';

const d = (text: string): HugeNumber => HugeNumber.fromDecimal(text);

/**
 * Rule set 1 — the first playable balance (Phase 1).
 *
 * Every value here is provisional balance, not a design commitment
 * (docs/GAME_DESIGN.md). Once any result produced under version 1 is persisted,
 * this object is frozen history: a balance change becomes a new rule set with a
 * new version, and this one stays so old results remain reproducible.
 */
export const RULES_V1: GameRules = {
  version: 1,
  combat: {
    timeLimitMs: 30_000,
    maxAttackSpeedBp: 100_000, // 10 attacks per second
    maxCritChanceBp: 10_000, // 100%
  },
  character: {
    baseStats: {
      maxHealth: d('100'),
      damage: d('10'),
      attackSpeedBp: 10_000,
      critChanceBp: 500,
      critDamageBp: 15_000,
    },
    healthGrowthPerLevel: d('1.10'),
    damageGrowthPerLevel: d('1.10'),
  },
  stages: {
    bossInterval: 10,
    baseEnemyHealth: d('40'),
    baseEnemyDamage: d('4'),
    enemyHealthGrowth: d('1.12'),
    enemyDamageGrowth: d('1.09'),
    regularArchetype: {
      id: 'husk',
      healthMultiplier: d('1'),
      damageMultiplier: d('1'),
      attackSpeedBp: 8_000,
      critChanceBp: 0,
      critDamageBp: 15_000,
    },
    bossArchetype: {
      id: 'warden',
      healthMultiplier: d('5'),
      damageMultiplier: d('1.5'),
      attackSpeedBp: 7_000,
      critChanceBp: 500,
      critDamageBp: 15_000,
    },
  },
  rewards: {
    baseGold: d('5'),
    goldGrowth: d('1.12'),
    baseExperience: d('3'),
    experienceGrowth: d('1.10'),
    bossRewardMultiplier: d('5'),
  },
};
