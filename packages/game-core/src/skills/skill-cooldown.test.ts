import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GameCoreError, type GameCoreErrorCode } from '../errors.js';
import {
  SKILL_CATALOG,
  SKILL_DURATION_MAX_MS,
  SkillDefinitionId,
  SkillLevel,
  SkillRules,
  initialSkillCooldownState,
  isSkillReady,
  resolveSkillAtLevel,
  startSkillCooldown,
  validateCombatTimeMs,
  type ResolvedSkill,
} from './index.js';

function expectCode(operation: () => unknown, code: GameCoreErrorCode): void {
  expect(operation).toThrow(GameCoreError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

/** Test fixture, not balance: a skill whose cooldown is `cooldownMs` at every level. */
function skillWithCooldown(cooldownMs: number, id = 'fireball'): ResolvedSkill {
  const rules = new SkillRules(SKILL_CATALOG, [
    { skillId: id, cooldownMs: { base: cooldownMs, perLevel: 0 } },
  ]);
  return resolveSkillAtLevel(
    SKILL_CATALOG.require(SkillDefinitionId.parse(id)),
    SkillLevel.FIRST,
    rules,
  );
}

const FIREBALL = SkillDefinitionId.parse('fireball');

describe('skill cooldown on the combat timeline', () => {
  it('is ready at combat time zero', () => {
    const state = initialSkillCooldownState(FIREBALL);
    expect(state.nextReadyAtMs).toBe(0);
    expect(isSkillReady(state, 0)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('cooldown 5 000 ms cast at 1 000 ms: not ready at 5 999 ms, ready at exactly 6 000 ms', () => {
    const skill = skillWithCooldown(5_000);
    const afterCast = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 1_000);
    expect(afterCast.nextReadyAtMs).toBe(6_000);
    expect(isSkillReady(afterCast, 1_000)).toBe(false);
    expect(isSkillReady(afterCast, 1_001)).toBe(false);
    expect(isSkillReady(afterCast, 5_999)).toBe(false);
    expect(isSkillReady(afterCast, 6_000)).toBe(true);
    expect(isSkillReady(afterCast, 6_001)).toBe(true);
  });

  it('starts the cooldown at the cast instant, also at time zero', () => {
    const afterCast = startSkillCooldown(
      initialSkillCooldownState(FIREBALL),
      skillWithCooldown(5_000),
      0,
    );
    expect(afterCast.nextReadyAtMs).toBe(5_000);
    expect(isSkillReady(afterCast, 0)).toBe(false);
  });

  it('measures each cooldown from its own cast, not from the previous ready time', () => {
    const skill = skillWithCooldown(5_000);
    const first = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 0);
    const second = startSkillCooldown(first, skill, 5_000);
    expect(second.nextReadyAtMs).toBe(10_000);
    const late = startSkillCooldown(second, skill, 12_345);
    expect(late.nextReadyAtMs).toBe(17_345);
  });

  it('refuses a cast before the cooldown has ended', () => {
    const skill = skillWithCooldown(5_000);
    const afterCast = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 1_000);
    expectCode(() => startSkillCooldown(afterCast, skill, 5_999), 'SKILL_NOT_READY');
    expect(startSkillCooldown(afterCast, skill, 6_000).nextReadyAtMs).toBe(11_000);
  });

  it('casts at most once per instant even at the minimum cooldown', () => {
    const skill = skillWithCooldown(1);
    const afterCast = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 7);
    expectCode(() => startSkillCooldown(afterCast, skill, 7), 'SKILL_NOT_READY');
    expect(isSkillReady(afterCast, 8)).toBe(true);
  });

  it('does not mutate the previous state', () => {
    const initial = initialSkillCooldownState(FIREBALL);
    const next = startSkillCooldown(initial, skillWithCooldown(5_000), 0);
    expect(initial.nextReadyAtMs).toBe(0);
    expect(next).not.toBe(initial);
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('refuses a state of another skill', () => {
    expectCode(
      () =>
        startSkillCooldown(
          initialSkillCooldownState(SkillDefinitionId.parse('shield')),
          skillWithCooldown(5_000),
          0,
        ),
      'INVALID_ARGUMENT',
    );
  });

  it('handles large combat times exactly', () => {
    const skill = skillWithCooldown(SKILL_DURATION_MAX_MS);
    const castAt = Number.MAX_SAFE_INTEGER - SKILL_DURATION_MAX_MS;
    const afterCast = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, castAt);
    expect(afterCast.nextReadyAtMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(isSkillReady(afterCast, Number.MAX_SAFE_INTEGER - 1)).toBe(false);
    expect(isSkillReady(afterCast, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('refuses a next ready time beyond the safe-integer range', () => {
    const skill = skillWithCooldown(2);
    expectCode(
      () =>
        startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, Number.MAX_SAFE_INTEGER - 1),
      'OUT_OF_RANGE',
    );
  });

  it.each([
    [-1, 'NEGATIVE_VALUE'],
    [Number.MIN_SAFE_INTEGER, 'NEGATIVE_VALUE'],
    [0.5, 'NOT_A_SAFE_INTEGER'],
    [Number.NaN, 'NOT_A_SAFE_INTEGER'],
    [Number.POSITIVE_INFINITY, 'NOT_A_SAFE_INTEGER'],
    [2 ** 53, 'NOT_A_SAFE_INTEGER'],
  ] as const)('rejects the combat time %d', (combatTimeMs, code) => {
    expectCode(() => validateCombatTimeMs(combatTimeMs), code);
    expectCode(() => isSkillReady(initialSkillCooldownState(FIREBALL), combatTimeMs), code);
    expectCode(
      () =>
        startSkillCooldown(
          initialSkillCooldownState(FIREBALL),
          skillWithCooldown(5_000),
          combatTimeMs,
        ),
      code,
    );
  });

  it('is deterministic: the same state and time always give the same answer', () => {
    const skill = skillWithCooldown(5_000);
    const state = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 1_000);
    const replayed = startSkillCooldown(initialSkillCooldownState(FIREBALL), skill, 1_000);
    expect(replayed).toEqual(state);
    for (const time of [0, 5_999, 6_000, 1_000_000]) {
      expect(isSkillReady(replayed, time)).toBe(isSkillReady(state, time));
    }
  });

  it('property: ready exactly from cast + cooldown, never one millisecond earlier', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: SKILL_DURATION_MAX_MS }),
        fc.integer({ min: 0, max: 1e12 }),
        (cooldownMs, castAtMs) => {
          const afterCast = startSkillCooldown(
            initialSkillCooldownState(FIREBALL),
            skillWithCooldown(cooldownMs),
            castAtMs,
          );
          expect(afterCast.nextReadyAtMs).toBe(castAtMs + cooldownMs);
          expect(isSkillReady(afterCast, castAtMs + cooldownMs - 1)).toBe(false);
          expect(isSkillReady(afterCast, castAtMs + cooldownMs)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('property: casting whenever ready gives floor(T / c) + 1 casts in [0, T]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000 }),
        fc.integer({ min: 0, max: 30_000 }),
        (cooldownMs, horizonMs) => {
          const skill = skillWithCooldown(cooldownMs);
          let state = initialSkillCooldownState(FIREBALL);
          let casts = 0;
          for (let time = state.nextReadyAtMs; time <= horizonMs; time = state.nextReadyAtMs) {
            state = startSkillCooldown(state, skill, time);
            casts += 1;
          }
          expect(casts).toBe(Math.floor(horizonMs / cooldownMs) + 1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
