import type { SkillDefinitionId, SkillLevel } from '@eternal-forge/game-core';
import type { SkillState } from '../../domain/skill-state.js';

export interface ReplaceSkillLoadoutCommand {
  readonly authUserId: string;
  readonly characterId: string;
  /** The version the new loadout was validated against. */
  readonly expectedVersion: bigint;
  /** Validated by Game Core; index is the priority and the persisted position. */
  readonly loadout: readonly SkillDefinitionId[];
}

export interface TrustedSkillGrant {
  readonly characterId: string;
  readonly skillId: SkillDefinitionId;
  readonly level: SkillLevel;
}

/**
 * Persistence port for active skill source state (ADR-032).
 *
 * Every write advances `characters.version`, the token combat, equipment and
 * stage selection already share, so a future combat snapshot (PR 7.3) reads
 * level, equipment and skills as one coherent state.
 */
export interface SkillRepository {
  /**
   * One owner-scoped snapshot of the version, the owned skills and the
   * loadout; `null` for a missing or foreign character. A persisted state
   * Game Core refuses (an unknown ID, a hole in the positions) is corrupt
   * and throws rather than being repaired.
   */
  loadSkillState(authUserId: string, characterId: string): Promise<SkillState | null>;

  /**
   * Replaces the whole loadout in one transaction, conditional on
   * `expectedVersion` and the owner. `conflict` means nothing was written.
   */
  replaceLoadout(command: ReplaceSkillLoadoutCommand): Promise<'saved' | 'conflict'>;

  /**
   * Grants a skill or sets an owned skill's level, advancing the version.
   *
   * Trusted server systems and test fixtures only. No HTTP route calls it:
   * how a player acquires or levels a skill, and at what cost, is not
   * designed yet (ADR-032).
   */
  saveTrustedSkill(grant: TrustedSkillGrant): Promise<void>;
}

export const SKILL_REPOSITORY = Symbol('SKILL_REPOSITORY');
