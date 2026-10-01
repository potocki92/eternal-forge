import { GameCoreError } from '../errors.js';

/** The same human-reviewable key format as `ItemDefinitionId` (ADR-024). */
const DEFINITION_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

export const SKILL_DEFINITION_ID_MAX_LENGTH = 64;

/**
 * Stable identity of an active skill (ADR-031).
 *
 * A lowercase machine key such as `blood_strike`, never a player-facing name
 * and never derived from catalog order. Future persistence (skill ownership,
 * loadouts, combat snapshots) stores this value, so an identity, once
 * shipped, is never renamed or reused.
 */
export class SkillDefinitionId {
  private constructor(private readonly value: string) {
    Object.freeze(this);
  }

  /** @throws {GameCoreError} `INVALID_FORMAT` unless the value is a canonical key. */
  public static parse(value: string): SkillDefinitionId {
    if (value.length > SKILL_DEFINITION_ID_MAX_LENGTH || !DEFINITION_ID_PATTERN.test(value)) {
      throw new GameCoreError(
        'INVALID_FORMAT',
        'Skill definition ID must be 1–64 lowercase letters, digits or single underscores, starting with a letter.',
      );
    }
    return new SkillDefinitionId(value);
  }

  public equals(other: SkillDefinitionId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}
