import { GameCoreError } from '../errors.js';
import type { ResolvedSkill } from './skill-rules.js';
import type { SkillDefinitionId } from './skill-definition-id.js';

/**
 * Skill cooldowns on the deterministic combat timeline (ADR-031).
 *
 * Unit: whole milliseconds of **combat time** — the time axis of one
 * simulated combat, starting at 0 when the combat starts. It is the unit the
 * combat result already reports (`CombatEvent.timeMs`, `durationMs`) and the
 * unit of `CombatRules.timeLimitMs`. It is never wall-clock time: no `Date`,
 * no timestamp, no server or client clock and no animation timing can reach
 * these functions, so a replay is a function of its inputs alone.
 *
 * Semantics (historical once skills affect combat):
 *
 * - A skill is **ready at combat start**: its initial state is ready at 0 ms.
 * - A cast is **instantaneous** and its cooldown **starts at the cast
 *   instant**: cast at `t` with cooldown `c` → next ready at `t + c`.
 * - Readiness is **inclusive**: ready at `t` exactly when
 *   `t ≥ nextReadyAtMs`. Cooldown 5 000 ms, cast at 1 000 ms → not ready at
 *   5 999 ms, ready at 6 000 ms.
 * - A cooldown is at least {@link SKILL_COOLDOWN_MIN_MS} (zero is illegal, so a
 *   skill can never be cast twice at one instant and the number of casts in a
 *   time-limited combat is bounded) and at most {@link SKILL_DURATION_MAX_MS}.
 */

/** The shortest legal cooldown. Zero would allow unbounded casts at one instant. */
export const SKILL_COOLDOWN_MIN_MS = 1;

/**
 * Longest legal cooldown or skill duration: the PostgreSQL `integer` maximum
 * (about 24.8 days), so a resolved value can be snapshotted in an `integer`
 * column. A structural bound, not balance.
 */
export const SKILL_DURATION_MAX_MS = 2_147_483_647;

/** Where one skill's cooldown stands within one combat. */
export interface SkillCooldownState {
  readonly skillId: SkillDefinitionId;
  /** The first combat time, in ms, at which the skill may be cast. */
  readonly nextReadyAtMs: number;
}

/**
 * @throws {GameCoreError} `NOT_A_SAFE_INTEGER` or `NEGATIVE_VALUE` unless
 *   `combatTimeMs` is a whole, non-negative, safe number of milliseconds.
 */
export function validateCombatTimeMs(combatTimeMs: number): number {
  if (!Number.isSafeInteger(combatTimeMs)) {
    throw new GameCoreError(
      'NOT_A_SAFE_INTEGER',
      'Combat time must be a safe integer number of milliseconds.',
    );
  }
  if (combatTimeMs < 0) {
    throw new GameCoreError('NEGATIVE_VALUE', 'Combat time must not be negative.');
  }
  return combatTimeMs;
}

/** The state of a skill at combat start: ready at 0 ms. */
export function initialSkillCooldownState(skillId: SkillDefinitionId): SkillCooldownState {
  return Object.freeze({ skillId, nextReadyAtMs: 0 });
}

/** Whether the skill may be cast at `combatTimeMs` (inclusive boundary). */
export function isSkillReady(state: SkillCooldownState, combatTimeMs: number): boolean {
  return validateCombatTimeMs(combatTimeMs) >= state.nextReadyAtMs;
}

/**
 * The state after casting `skill` at `castAtMs`: the cooldown starts at the
 * cast instant.
 *
 * @throws {GameCoreError} `INVALID_ARGUMENT` if the state belongs to another
 *   skill, `SKILL_NOT_READY` before the cooldown has ended, `OUT_OF_RANGE` if
 *   the next ready time would leave the safe-integer range.
 */
export function startSkillCooldown(
  state: SkillCooldownState,
  skill: ResolvedSkill,
  castAtMs: number,
): SkillCooldownState {
  if (!state.skillId.equals(skill.id)) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Cooldown state of "${state.skillId.toString()}" cannot start a cast of "${skill.id.toString()}".`,
    );
  }
  if (!isSkillReady(state, castAtMs)) {
    throw new GameCoreError(
      'SKILL_NOT_READY',
      `Skill "${skill.id.toString()}" is not ready before ${String(state.nextReadyAtMs)} ms.`,
    );
  }
  const nextReadyAtMs = castAtMs + skill.cooldownMs;
  if (!Number.isSafeInteger(nextReadyAtMs)) {
    throw new GameCoreError('OUT_OF_RANGE', 'Next skill ready time exceeds the safe range.');
  }
  return Object.freeze({ skillId: state.skillId, nextReadyAtMs });
}
