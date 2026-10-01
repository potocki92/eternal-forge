import type { CharacterSkills } from '@eternal-forge/game-core';

/**
 * A character's skill source state at one version (ADR-032): owned skills,
 * their levels and the ordered loadout, validated by Game Core.
 */
export interface SkillState {
  /** The optimistic-concurrency version the state was read (or written) at. */
  readonly version: bigint;
  readonly skills: CharacterSkills;
}
