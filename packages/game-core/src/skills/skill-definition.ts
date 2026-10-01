import { GameCoreError } from '../errors.js';
import { SkillDefinitionId } from './skill-definition-id.js';

/**
 * The durable identity of an active skill (ADR-031).
 *
 * Deliberately small: identity and a localisation key only. Everything that
 * is balance — cooldown, level curves, effect parameters — lives in a
 * `SkillRules` tuning, which is versioned with the combat rules once skills
 * reach combat. A definition therefore never changes when a skill is
 * rebalanced, and it can exist before any of its gameplay is approved.
 */
export interface SkillDefinition {
  readonly id: SkillDefinitionId;
  /** Localisation key, always `skill.<id>.name`. Display text lives outside Game Core. */
  readonly nameKey: string;
}

export interface SkillDefinitionInput {
  readonly id: string;
  readonly nameKey: string;
}

/** @throws {GameCoreError} `INVALID_FORMAT` for a malformed ID or name key. */
export function createSkillDefinition(input: SkillDefinitionInput): SkillDefinition {
  const id = SkillDefinitionId.parse(input.id);
  if (input.nameKey !== `skill.${id.toString()}.name`) {
    throw new GameCoreError(
      'INVALID_FORMAT',
      `Skill name key must be "skill.${id.toString()}.name".`,
    );
  }
  return Object.freeze({ id, nameKey: input.nameKey });
}
