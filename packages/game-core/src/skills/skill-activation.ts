import { GameCoreError } from '../errors.js';
import type { SkillCooldownState } from './skill-cooldown.js';
import { isSkillReady, validateCombatTimeMs } from './skill-cooldown.js';
import type { ResolvedSkill } from './skill-rules.js';

/**
 * Whether a skill may be cast, and the boundary of the future activation
 * policy (ADR-031).
 *
 * Skills are cast by a deterministic policy inside the server's combat
 * simulation, never by a client during playback: online combat is resolved
 * before the browser shows it, so a playback-time "cast" could not change the
 * result. The existence of the skill and the validity of its level are
 * guaranteed by `ResolvedSkill`; eligibility today is the cooldown. Further
 * conditions (enemy or hero health thresholds, resources, targets) become
 * new block reasons when their mechanics are approved.
 */

/** Why an otherwise valid skill cannot be cast now. Extended, never reordered. */
export const SKILL_CAST_BLOCK_REASONS = ['ON_COOLDOWN'] as const;
export type SkillCastBlockReason = (typeof SKILL_CAST_BLOCK_REASONS)[number];

export type SkillCastEligibility =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: 'ON_COOLDOWN';
      /** The combat time at which the cooldown ends. */
      readonly readyAtMs: number;
    };

/** A skill the policy may cast, with its cooldown within the current combat. */
export interface SkillActivationCandidate {
  readonly skill: ResolvedSkill;
  readonly cooldown: SkillCooldownState;
}

const ELIGIBLE: SkillCastEligibility = Object.freeze({ eligible: true });

/**
 * @throws {GameCoreError} `INVALID_ARGUMENT` if the cooldown state belongs to
 *   another skill; the combat-time errors of `validateCombatTimeMs`.
 */
export function evaluateSkillCast(
  candidate: SkillActivationCandidate,
  combatTimeMs: number,
): SkillCastEligibility {
  if (!candidate.cooldown.skillId.equals(candidate.skill.id)) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      `Cooldown state of "${candidate.cooldown.skillId.toString()}" does not belong to "${candidate.skill.id.toString()}".`,
    );
  }
  if (isSkillReady(candidate.cooldown, combatTimeMs)) {
    return ELIGIBLE;
  }
  return Object.freeze({
    eligible: false,
    reason: 'ON_COOLDOWN',
    readyAtMs: candidate.cooldown.nextReadyAtMs,
  });
}

/**
 * The initial activation policy shape: the first eligible candidate in the
 * order the caller supplies, or `null`.
 *
 * The order is the player's priority — a future loadout (PR 7.2) — and is
 * never derived from catalog or tuning order. The function decides one
 * instant only; scheduling instants, ties with attacks and how many casts an
 * instant allows belong to the combat runtime (PR 7.3).
 *
 * @throws {GameCoreError} `INVALID_ARGUMENT` if a skill appears twice.
 */
export function selectSkillActivation(
  candidatesInPriorityOrder: readonly SkillActivationCandidate[],
  combatTimeMs: number,
): SkillActivationCandidate | null {
  validateCombatTimeMs(combatTimeMs);
  const seen = new Set<string>();
  for (const candidate of candidatesInPriorityOrder) {
    const key = candidate.skill.id.toString();
    if (seen.has(key)) {
      throw new GameCoreError('INVALID_ARGUMENT', `Skill "${key}" appears twice.`);
    }
    seen.add(key);
  }
  return (
    candidatesInPriorityOrder.find(
      (candidate) => evaluateSkillCast(candidate, combatTimeMs).eligible,
    ) ?? null
  );
}
