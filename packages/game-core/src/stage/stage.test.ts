import { describe, expect, it } from 'vitest';
import { createCharacter } from '../character/character.js';
import { createEnemyForStage } from '../enemy/enemy.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { calculateStageRewards } from '../rewards/rewards.js';
import { getGameRules } from '../rules/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { resolveStage } from './stage.js';
import { STAGE_NUMBER_MAX, StageNumber } from './stage-number.js';
import { scaleByStage } from './stage-scaling.js';

const rules = getGameRules(GAME_RULES_VERSION);
const at = (value: bigint | number) => StageNumber.of(value);

describe('stages', () => {
  it('marks every bossInterval-th stage as a boss', () => {
    const interval = rules.stages.bossInterval;
    expect(resolveStage(at(1), rules.stages).kind).toBe('REGULAR');
    expect(resolveStage(at(interval - 1), rules.stages).kind).toBe('REGULAR');
    expect(resolveStage(at(interval), rules.stages).kind).toBe('BOSS');
    expect(resolveStage(at(interval * 1_000_000), rules.stages).kind).toBe('BOSS');
  });

  it('classifies stages beyond the safe-integer range exactly', () => {
    // 2^53 + 1 is not representable as a double; as a float it would read as
    // 2^53, which is a multiple of 2 but hides the real remainder.
    const interval = BigInt(rules.stages.bossInterval);
    const beyondFloat = 2n ** 53n * interval + interval;
    expect(resolveStage(at(beyondFloat), rules.stages).kind).toBe('BOSS');
    expect(resolveStage(at(beyondFloat + 1n), rules.stages).kind).toBe('REGULAR');
    expect(resolveStage(at(STAGE_NUMBER_MAX), rules.stages).number.toBigInt()).toBe(
      STAGE_NUMBER_MAX,
    );
  });
});

describe('stage scaling', () => {
  const stage = (number: number) => resolveStage(at(number), rules.stages);

  it('is base × growth^(stage − 1)', () => {
    const base = HugeNumber.fromNumber(40);
    const growth = HugeNumber.fromDecimal('1.12');
    expect(scaleByStage(base, growth, stage(1))).toEqual(base);
    expect(scaleByStage(base, growth, stage(2)).toString()).toBe('4.48e1');
    expect(scaleByStage(base, growth, stage(3)).toString()).toBe('5.0176e1');
  });

  it('is strictly increasing for regular enemies and reaches far beyond float64', () => {
    let previous = createEnemyForStage(at(1), rules).stats.maxHealth;
    for (let number = 2; number < 200; number += 1) {
      if (
        number % rules.stages.bossInterval === 0 ||
        (number - 1) % rules.stages.bossInterval === 0
      ) {
        continue;
      }
      const health = createEnemyForStage(at(number), rules).stats.maxHealth;
      expect(health.gt(previous)).toBe(true);
      previous = health;
    }
    const deep = createEnemyForStage(at(1_000_000), rules).stats.maxHealth;
    expect(deep.toParts().exponent).toBeGreaterThan(308);
  });

  it('refuses a stage too deep for the rule set instead of returning a wrong value', () => {
    expect(() => createEnemyForStage(at(STAGE_NUMBER_MAX), rules)).toThrow(
      expect.objectContaining({ code: 'OVERFLOW' }),
    );
  });

  it('builds enemies from archetype data', () => {
    const regular = createEnemyForStage(at(1), rules);
    expect(regular.archetypeId).toBe(rules.stages.regularArchetype.id);
    expect(regular.stats.maxHealth).toEqual(rules.stages.baseEnemyHealth);
    expect(regular.stats.attackSpeedBp).toBe(rules.stages.regularArchetype.attackSpeedBp);

    const boss = createEnemyForStage(at(rules.stages.bossInterval), rules);
    const regularEquivalent = scaleByStage(
      rules.stages.baseEnemyHealth,
      rules.stages.enemyHealthGrowth,
      boss.stage,
    );
    expect(boss.archetypeId).toBe(rules.stages.bossArchetype.id);
    expect(boss.stats.maxHealth).toEqual(
      regularEquivalent.mul(rules.stages.bossArchetype.healthMultiplier),
    );
  });
});

describe('character', () => {
  it('starts from the rule set base stats at level 1', () => {
    expect(createCharacter(1, rules)).toEqual({ level: 1, stats: rules.character.baseStats });
  });

  it('grows health and damage per level', () => {
    const level2 = createCharacter(2, rules).stats;
    expect(level2.maxHealth).toEqual(
      rules.character.baseStats.maxHealth.mul(rules.character.healthGrowthPerLevel),
    );
    expect(level2.damage).toEqual(
      rules.character.baseStats.damage.mul(rules.character.damageGrowthPerLevel),
    );
    expect(level2.attackSpeedBp).toBe(rules.character.baseStats.attackSpeedBp);
  });

  it.each([0, -3, 2.5, Number.NaN])('rejects level %s', (level) => {
    expect(() => createCharacter(level, rules)).toThrow(GameCoreError);
  });
});

describe('rewards', () => {
  it('scales per stage and floors to whole amounts', () => {
    const first = calculateStageRewards(resolveStage(at(1), rules.stages), rules.rewards);
    expect(first.gold).toEqual(rules.rewards.baseGold.floor());
    expect(first.experience).toEqual(rules.rewards.baseExperience.floor());

    for (const number of [2, 3, 17, 250]) {
      const rewards = calculateStageRewards(resolveStage(at(number), rules.stages), rules.rewards);
      expect(rewards.gold.isInteger()).toBe(true);
      expect(rewards.experience.isInteger()).toBe(true);
    }
  });

  it('multiplies boss rewards', () => {
    const bossStage = resolveStage(at(rules.stages.bossInterval), rules.stages);
    const rewards = calculateStageRewards(bossStage, rules.rewards);
    const regularGold = scaleByStage(rules.rewards.baseGold, rules.rewards.goldGrowth, bossStage);
    expect(rewards.gold).toEqual(regularGold.mul(rules.rewards.bossRewardMultiplier).floor());
  });

  it('is never negative', () => {
    for (const number of [1, 10, 1_000, 1_000_000]) {
      const rewards = calculateStageRewards(resolveStage(at(number), rules.stages), rules.rewards);
      expect(rewards.gold.isNegative()).toBe(false);
      expect(rewards.experience.isNegative()).toBe(false);
    }
  });
});
