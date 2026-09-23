import { CHARACTER_LEVEL_MAX, validateLevel } from '../character/character.js';
import { GameCoreError } from '../errors.js';
import type { HugeNumber } from '../huge-number/index.js';
import type { ProgressionRules } from '../rules/index.js';

/**
 * Upper bound on levels gained from one experience gain, so a single call does
 * bounded work (docs/SECURITY.md — "Work is bounded"). Experience beyond it
 * stays banked and is consumed by the next gain. Under `RULES_V1` a gain is
 * worth a handful of levels at most, because levels only come from stages the
 * character was strong enough to clear.
 */
export const MAX_LEVELS_PER_GAIN = 1_000;

/** A level together with the experience earned towards the next one. */
export interface LevelProgress {
  readonly level: number;
  /** Experience within the current level. A whole, non-negative amount. */
  readonly experience: HugeNumber;
}

export interface ExperienceGainResult extends LevelProgress {
  readonly levelsGained: number;
}

/**
 * Experience needed to go from `level` to `level + 1`:
 * `floor(base × growth^(level − 1))`.
 */
export function experienceToNextLevel(level: number, rules: ProgressionRules): HugeNumber {
  validateLevel(level);
  return rules.experienceToLevelBase.mul(rules.experienceToLevelGrowth.pow(level - 1)).floor();
}

/** Rejects a stored or computed quantity that no rule could have produced. */
export function requireWholeAmount(value: HugeNumber, field: string): HugeNumber {
  value.ensureNonNegative(field);
  if (!value.isInteger()) {
    throw new GameCoreError('INVALID_ARGUMENT', `${field} must be a whole amount.`);
  }
  return value;
}

/**
 * Adds experience and levels up while the requirement is met.
 *
 * Each level-up spends that level's requirement. Leveling stops at
 * {@link CHARACTER_LEVEL_MAX} or after {@link MAX_LEVELS_PER_GAIN} levels;
 * any experience left over is kept, never discarded.
 */
export function applyExperience(
  progress: LevelProgress,
  gained: HugeNumber,
  rules: ProgressionRules,
): ExperienceGainResult {
  validateLevel(progress.level);
  requireWholeAmount(progress.experience, 'experience');
  requireWholeAmount(gained, 'gained experience');

  let level = progress.level;
  let experience = progress.experience.add(gained);
  let levelsGained = 0;

  while (level < CHARACTER_LEVEL_MAX && levelsGained < MAX_LEVELS_PER_GAIN) {
    const required = experienceToNextLevel(level, rules);
    if (experience.lt(required)) {
      break;
    }
    experience = experience.sub(required);
    level += 1;
    levelsGained += 1;
  }

  return { level, experience, levelsGained };
}
