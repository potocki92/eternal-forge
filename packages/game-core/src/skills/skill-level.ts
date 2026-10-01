import { GameCoreError } from '../errors.js';

/**
 * Highest skill level: the PostgreSQL `integer` maximum, `2^31 − 1`, the same
 * structural bound as `CHARACTER_LEVEL_MAX`.
 *
 * No design document defines a skill level cap, so none is invented here
 * (ADR-031). This bound only guarantees that every legal level fits a future
 * `integer` column and stays exact as a JavaScript `number`. A per-skill
 * content cap, if balance ever wants one, becomes tuning data.
 */
export const SKILL_LEVEL_MAX = 2_147_483_647;

/**
 * The level of an owned active skill: a whole number from 1 to
 * {@link SKILL_LEVEL_MAX}. There is no level 0: an unowned skill is absent, not
 * a skill at level 0.
 *
 * Serialises to its number (`toJSON`).
 */
export class SkillLevel {
  /** The level a skill starts at. */
  public static readonly FIRST = new SkillLevel(1);

  private constructor(private readonly value: number) {
    Object.freeze(this);
  }

  /** @throws {GameCoreError} `NOT_A_SAFE_INTEGER` or `OUT_OF_RANGE`. */
  public static of(value: number): SkillLevel {
    if (!Number.isSafeInteger(value)) {
      throw new GameCoreError('NOT_A_SAFE_INTEGER', 'Skill level must be a safe integer.');
    }
    if (value < 1 || value > SKILL_LEVEL_MAX) {
      throw new GameCoreError(
        'OUT_OF_RANGE',
        `Skill level must be from 1 to ${String(SKILL_LEVEL_MAX)}.`,
      );
    }
    return value === 1 ? SkillLevel.FIRST : new SkillLevel(value);
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: SkillLevel): boolean {
    return this.value === other.value;
  }

  public toJSON(): number {
    return this.value;
  }
}
