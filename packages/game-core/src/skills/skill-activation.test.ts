import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import {
  SKILL_CAST_BLOCK_REASONS,
  SKILL_CATALOG,
  SkillDefinitionId,
  SkillLevel,
  SkillRules,
  evaluateSkillCast,
  initialSkillCooldownState,
  resolveSkillAtLevel,
  selectSkillActivation,
  startSkillCooldown,
  type SkillActivationCandidate,
} from './index.js';

function expectCode(operation: () => unknown, code: GameCoreErrorCode): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

/** Test fixture, not balance. */
const rules = new SkillRules(SKILL_CATALOG, [
  { skillId: 'whirlwind', cooldownMs: { base: 4_000, perLevel: 0 } },
  { skillId: 'fireball', cooldownMs: { base: 5_000, perLevel: 0 } },
  { skillId: 'shield', cooldownMs: { base: 12_000, perLevel: 0 } },
]);

function candidate(id: string): SkillActivationCandidate {
  const skill = resolveSkillAtLevel(
    SKILL_CATALOG.require(SkillDefinitionId.parse(id)),
    SkillLevel.FIRST,
    rules,
  );
  return { skill, cooldown: initialSkillCooldownState(skill.id) };
}

function cast(entry: SkillActivationCandidate, atMs: number): SkillActivationCandidate {
  return { skill: entry.skill, cooldown: startSkillCooldown(entry.cooldown, entry.skill, atMs) };
}

describe('evaluateSkillCast', () => {
  it('is eligible when the cooldown is ready', () => {
    expect(evaluateSkillCast(candidate('fireball'), 0)).toEqual({ eligible: true });
  });

  it('names the reason and the ready time while on cooldown', () => {
    const onCooldown = cast(candidate('fireball'), 1_000);
    expect(evaluateSkillCast(onCooldown, 5_999)).toEqual({
      eligible: false,
      reason: 'ON_COOLDOWN',
      readyAtMs: 6_000,
    });
    expect(evaluateSkillCast(onCooldown, 6_000)).toEqual({ eligible: true });
  });

  it('has an extensible, explicit list of block reasons', () => {
    expect(SKILL_CAST_BLOCK_REASONS).toEqual(['ON_COOLDOWN']);
  });

  it('refuses a cooldown state of another skill', () => {
    const fireball = candidate('fireball');
    expectCode(
      () => evaluateSkillCast({ skill: fireball.skill, cooldown: candidate('shield').cooldown }, 0),
      'INVALID_ARGUMENT',
    );
  });

  it('rejects an invalid combat time', () => {
    expectCode(() => evaluateSkillCast(candidate('fireball'), -1), 'NEGATIVE_VALUE');
  });
});

describe('selectSkillActivation', () => {
  it('picks the first ready skill in the caller-supplied priority order', () => {
    const shieldFirst = [candidate('shield'), candidate('fireball')];
    expect(selectSkillActivation(shieldFirst, 0)?.skill.id.toString()).toBe('shield');
  });

  it('never uses catalog order as priority', () => {
    // Catalog order is whirlwind, fireball, …, shield; the caller's order wins.
    const reversed = [candidate('shield'), candidate('fireball'), candidate('whirlwind')];
    expect(selectSkillActivation(reversed, 0)?.skill.id.toString()).toBe('shield');
    const forward = [candidate('whirlwind'), candidate('fireball'), candidate('shield')];
    expect(selectSkillActivation(forward, 0)?.skill.id.toString()).toBe('whirlwind');
  });

  it('skips skills on cooldown and returns null when nothing is ready', () => {
    const shield = cast(candidate('shield'), 0);
    const fireball = candidate('fireball');
    expect(selectSkillActivation([shield, fireball], 100)?.skill.id.toString()).toBe('fireball');
    const both = [shield, cast(fireball, 100)];
    expect(selectSkillActivation(both, 5_099)).toBeNull();
    expect(selectSkillActivation(both, 5_100)?.skill.id.toString()).toBe('fireball');
    expect(selectSkillActivation([], 0)).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const entries = [cast(candidate('fireball'), 0), candidate('shield')];
    expect(selectSkillActivation(entries, 3_000)).toBe(selectSkillActivation(entries, 3_000));
  });

  it('refuses a skill listed twice', () => {
    expectCode(
      () => selectSkillActivation([candidate('fireball'), candidate('fireball')], 0),
      'INVALID_ARGUMENT',
    );
  });

  it('rejects an invalid combat time even with no candidates', () => {
    expectCode(() => selectSkillActivation([], 0.5), 'NOT_A_SAFE_INTEGER');
  });
});
