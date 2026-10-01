import {
  GameCoreError,
  SkillDefinitionId,
  replaceSkillLoadout,
  sameSkillLoadout,
  type CharacterSkills,
} from '@eternal-forge/game-core';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import type { SkillState } from '../domain/skill-state.js';
import { SKILL_REPOSITORY, type SkillRepository } from './ports/skill-repository.port.js';

export type SkillStateResult =
  { readonly kind: 'found'; readonly state: SkillState } | { readonly kind: 'not-found' };

/** Why a requested loadout is malformed, independent of what the character owns. */
export type InvalidLoadoutReason = 'MALFORMED_ID' | 'UNKNOWN_SKILL' | 'TOO_LARGE' | 'DUPLICATE';

export type SetSkillLoadoutResult =
  | SkillStateResult
  | { readonly kind: 'invalid'; readonly reason: InvalidLoadoutReason }
  /** A known skill the character does not own. Nothing is written. */
  | { readonly kind: 'not-owned' }
  /** The character kept changing under every attempt. Nothing is written. */
  | { readonly kind: 'conflict' };

/**
 * Attempts before giving up on a character that keeps changing. The loadout
 * only races combats (spaced by whole seconds) and other configuration
 * commands, so a second attempt practically always succeeds.
 */
export const SET_SKILL_LOADOUT_MAX_ATTEMPTS = 3;

/** Query: the character's owned skills, levels and loadout (ADR-032). Writes nothing. */
@Injectable()
export class GetSkillStateUseCase {
  constructor(@Inject(SKILL_REPOSITORY) private readonly repository: SkillRepository) {}

  async execute(identity: AuthenticatedIdentity, characterId: string): Promise<SkillStateResult> {
    const state = await this.repository.loadSkillState(identity.authUserId, characterId);
    return state === null ? { kind: 'not-found' } : { kind: 'found', state };
  }
}

/**
 * Command: replace the character's whole loadout with `skillIds`, in
 * priority order (ADR-032).
 *
 * 1. Load the owned character's skills and version — one snapshot.
 * 2. Game Core validates the requested loadout against the owned skills:
 *    size, duplicates, catalog membership, ownership. The API adds no rule.
 * 3. The same loadout in the same order writes nothing and keeps the version.
 * 4. Otherwise one transaction, conditional on the version, replaces every
 *    loadout row and advances the version.
 * 5. If the version moved on, the request is validated again against the
 *    fresh state and retried, a bounded number of times.
 *
 * Set semantics make the command naturally idempotent: repeating it leaves
 * the same state, so it needs no idempotency key.
 */
@Injectable()
export class SetSkillLoadoutUseCase {
  constructor(@Inject(SKILL_REPOSITORY) private readonly repository: SkillRepository) {}

  async execute(
    identity: AuthenticatedIdentity,
    characterId: string,
    skillIds: readonly string[],
  ): Promise<SetSkillLoadoutResult> {
    if (!skillIds.every((value) => SkillDefinitionId.isCanonical(value))) {
      return { kind: 'invalid', reason: 'MALFORMED_ID' };
    }
    const requested = skillIds.map((value) => SkillDefinitionId.parse(value));

    for (let attempt = 1; attempt <= SET_SKILL_LOADOUT_MAX_ATTEMPTS; attempt += 1) {
      const state = await this.repository.loadSkillState(identity.authUserId, characterId);
      if (state === null) return { kind: 'not-found' };

      const next = validate(state.skills, requested);
      if ('kind' in next) return next;
      if (sameSkillLoadout(state.skills.loadout, next.loadout)) return { kind: 'found', state };

      const saved = await this.repository.replaceLoadout({
        authUserId: identity.authUserId,
        characterId,
        expectedVersion: state.version,
        loadout: next.loadout.map((skill) => skill.id),
      });
      // The write was conditional on this version and advanced it by one, and
      // ownership cannot change without advancing it too: the committed state
      // is exactly `next` at version + 1.
      if (saved === 'saved') {
        return { kind: 'found', state: { version: state.version + 1n, skills: next } };
      }
    }
    return { kind: 'conflict' };
  }
}

function validate(
  skills: CharacterSkills,
  requested: readonly SkillDefinitionId[],
): CharacterSkills | Exclude<SetSkillLoadoutResult, SkillStateResult | { kind: 'conflict' }> {
  try {
    return replaceSkillLoadout(skills, requested);
  } catch (error) {
    if (!(error instanceof GameCoreError)) throw error;
    switch (error.code) {
      case 'SKILL_LOADOUT_TOO_LARGE':
        return { kind: 'invalid', reason: 'TOO_LARGE' };
      case 'DUPLICATE_SKILL':
        return { kind: 'invalid', reason: 'DUPLICATE' };
      case 'UNKNOWN_SKILL_DEFINITION':
        return { kind: 'invalid', reason: 'UNKNOWN_SKILL' };
      case 'SKILL_NOT_OWNED':
        return { kind: 'not-owned' };
      default:
        throw error;
    }
  }
}
