import { describe, expect, it } from 'vitest';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { GAME_RULES_VERSION } from '../rules-version.js';
import { validateCombatStats } from '../stats/combat-stats.js';
import { getGameRules, supportedRulesVersions } from './registry.js';

describe('game rules registry', () => {
  it('supports the current rules version', () => {
    expect(supportedRulesVersions()).toContain(GAME_RULES_VERSION);
    expect(getGameRules(GAME_RULES_VERSION).version).toBe(GAME_RULES_VERSION);
  });

  it('keys every rule set by its own version', () => {
    for (const version of supportedRulesVersions()) {
      expect(getGameRules(version).version).toBe(version);
    }
  });

  it.each([0, 2, -1, 1.5, Number.NaN])('rejects unsupported version %s', (version) => {
    expect(() => getGameRules(version)).toThrow(GameCoreError);
  });

  it('freezes rule sets so balance cannot be mutated at runtime', () => {
    const rules = getGameRules(GAME_RULES_VERSION);
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules.stages.bossArchetype)).toBe(true);
    expect(Object.isFrozen(rules.character.baseStats)).toBe(true);
    expect(Object.isFrozen(rules.progression)).toBe(true);
    expect(Object.isFrozen(rules.offline)).toBe(true);
  });

  it('contains only internally consistent data', () => {
    for (const version of supportedRulesVersions()) {
      const rules = getGameRules(version);
      validateCombatStats(rules.character.baseStats, 'character');
      for (const archetype of [rules.stages.regularArchetype, rules.stages.bossArchetype]) {
        validateCombatStats(
          {
            maxHealth: rules.stages.baseEnemyHealth.mul(archetype.healthMultiplier),
            damage: rules.stages.baseEnemyDamage.mul(archetype.damageMultiplier),
            attackSpeedBp: archetype.attackSpeedBp,
            critChanceBp: archetype.critChanceBp,
            critDamageBp: archetype.critDamageBp,
          },
          archetype.id,
        );
      }
      expect(rules.stages.regularArchetype.id).not.toBe(rules.stages.bossArchetype.id);
      expect(Number.isSafeInteger(rules.stages.bossInterval)).toBe(true);
      expect(rules.stages.bossInterval).toBeGreaterThan(0);
      expect(rules.combat.timeLimitMs).toBeGreaterThan(0);
      expect(rules.combat.maxCritChanceBp).toBeLessThanOrEqual(10_000);
      // Every level must cost at least one point of experience, and never get
      // cheaper, or a single gain could level indefinitely.
      expect(rules.progression.experienceToLevelBase.gte(HugeNumber.ONE)).toBe(true);
      expect(rules.progression.experienceToLevelGrowth.gte(HugeNumber.ONE)).toBe(true);
      expect(Number.isSafeInteger(rules.progression.stagesLostOnDefeat)).toBe(true);
      expect(rules.progression.stagesLostOnDefeat).toBeGreaterThanOrEqual(0);
      // Offline progression (ADR-023): whole milliseconds, a real cap, and a
      // minimum absence long enough for any combat, so an eligible claim
      // always fits at least one fight.
      expect(Number.isSafeInteger(rules.offline.capMs)).toBe(true);
      expect(Number.isSafeInteger(rules.offline.minimumAbsenceMs)).toBe(true);
      expect(rules.offline.minimumAbsenceMs).toBeGreaterThanOrEqual(rules.combat.timeLimitMs);
      expect(rules.offline.capMs).toBeGreaterThanOrEqual(rules.offline.minimumAbsenceMs);
    }
  });
});
