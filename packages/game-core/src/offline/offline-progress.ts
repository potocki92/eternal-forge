import { createCharacter, type Character } from '../character/character.js';
import { simulateCombat } from '../combat/index.js';
import { createEnemyForStage, type Enemy } from '../enemy/enemy.js';
import { GameCoreError } from '../errors.js';
import { HugeNumber } from '../huge-number/index.js';
import { applyExperience, requireWholeAmount } from '../progression/level.js';
import type { CharacterProgress } from '../progression/stage-attempt.js';
import { createStageProgress, type StageProgress } from '../progression/stage-progress.js';
import { calculateStageRewards, NO_REWARDS, type StageRewards } from '../rewards/rewards.js';
import { deriveSeed } from '../rng/index.js';
import { getGameRules, type GameRules } from '../rules/index.js';
import type { Stage, StageNumber } from '../stage/index.js';

/**
 * Hard upper bound on the fights one offline resolution simulates, so a single
 * claim is bounded work whatever the rules or the input (docs/SECURITY.md —
 * "Work is bounded").
 *
 * Under `RULES_V1` no combat ends before the player's first attack lands at
 * 1 000 ms, so the 8-hour cap fits at most 28 800 fights. A rule set that could
 * fit more is refused with `LIMIT_EXCEEDED` after this many fights, instead of
 * consuming unbounded CPU; the rule-registry tests prove every registered rule
 * set stays below it.
 */
export const MAX_OFFLINE_FIGHTS = 30_000;

/** Why an offline resolution fought nothing. */
export type OfflineIdleReason =
  /** Less idle time than the rule set's minimum absence. It stays unprocessed. */
  | 'TOO_SOON'
  /** No stage has been cleared yet, so there is nothing safe to farm. */
  | 'NO_CLEARED_STAGE'
  /** The farm stage is valid but beyond what the rule set can scale (ADR-018). */
  | 'STAGE_NOT_PLAYABLE';

export interface OfflineProgressInput {
  /** The character's persisted progress when the claim was made. */
  readonly progress: CharacterProgress;
  /**
   * Idle server time since the character's processed boundary, in whole
   * milliseconds. Measured by the server; never supplied by a client.
   */
  readonly elapsedMs: number;
  /** Server-held seed. Fight `n` uses `deriveSeed(seed, 'offline', n)`. */
  readonly seed: string;
  readonly rulesVersion: number;
}

export interface OfflineProgressResult {
  readonly rulesVersion: number;
  readonly seed: string;
  /** The idle time the claim found. */
  readonly elapsedMs: number;
  /** The part of it that can be rewarded: at most the rule set's cap. */
  readonly rewardedMs: number;
  /** Whether `elapsedMs` exceeded the cap. */
  readonly capReached: boolean;
  /**
   * The rewarded time the fights filled. Always at most `rewardedMs`; the
   * remainder is shorter than one fight and stays unprocessed.
   */
  readonly consumedMs: number;
  /** The stage farmed, classified by the rules, or `null` when none is eligible. */
  readonly target: Stage | null;
  /** Set exactly when no fight was fought. */
  readonly idleReason: OfflineIdleReason | null;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  /** Sum of the rewards of every won fight. */
  readonly rewards: StageRewards;
  readonly levelsGained: number;
  readonly before: CharacterProgress;
  /**
   * Level, experience and gold after the fights. `after.stages` is
   * `before.stages`, unchanged: offline progression never moves the current
   * stage, the stage mode or a record.
   */
  readonly after: CharacterProgress;
}

/**
 * The stage offline progression farms (ADR-023): the character's current stage
 * if it has been cleared, otherwise its highest cleared stage — so
 * `min(current, highestCleared)`, and `null` before the first clear.
 *
 * - An intentional farm stage at or below the record is respected.
 * - A hero standing on its unbeaten frontier (a boss it lost to, or the next
 *   stage it is climbing to) farms the last stage it has proven it can clear.
 * - An uncleared stage is never fought offline, so offline progression can
 *   never clear a boss, unlock a stage or set any record.
 */
export function offlineFarmStage(stages: StageProgress): StageNumber | null {
  const progress = createStageProgress(stages);
  if (progress.highestCleared === null) {
    return null;
  }
  return progress.current.compare(progress.highestCleared) <= 0
    ? progress.current
    : progress.highestCleared;
}

function validateElapsed(elapsedMs: number): number {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) {
    throw new GameCoreError(
      'INVALID_ARGUMENT',
      'Elapsed offline time must be a non-negative whole number of milliseconds.',
    );
  }
  return elapsedMs;
}

function playableEnemy(stage: StageNumber, rules: GameRules): Enemy | null {
  try {
    return createEnemyForStage(stage, rules);
  } catch (error) {
    if (error instanceof GameCoreError && error.code === 'OVERFLOW') {
      return null;
    }
    throw error;
  }
}

/**
 * Offline progression: what the character's idle time was worth (ADR-023).
 *
 * A pure function of `(progress, elapsedMs, seed, rulesVersion)` — no clock, no
 * I/O, no ambient randomness. It is the same game as a fight in front of the
 * player, repeated:
 *
 * 1. The rewarded time is `min(elapsedMs, cap)`. Less than the minimum absence
 *    is not converted at all.
 * 2. The hero farms {@link offlineFarmStage}: a stage it has already cleared.
 * 3. Fights follow each other back to back, each occupying the hero for its
 *    simulated duration, exactly like the online pacing gate (ADR-019 §4).
 *    Fight `n` uses the seed `deriveSeed(seed, 'offline', n)`. A fight that
 *    would end after the rewarded time is not fought.
 * 4. Each fight is the ordinary combat against the stage's enemy with stats
 *    from the character's level *at that moment*. A win pays the stage's
 *    ordinary rewards and applies the experience through the ordinary level
 *    rule; a level-up therefore strengthens every later fight. A loss pays
 *    nothing and costs nothing but its time.
 *
 * This is `resolveStageAttempt` in `FARM` mode, fight after fight, with the
 * stage-independent parts (enemy, rewards) computed once: a property test
 * proves the two agree. No formula here is offline-specific.
 *
 * @throws {GameCoreError} `INVALID_ARGUMENT` for invalid progress or time,
 * `LIMIT_EXCEEDED` if the rules would allow more than
 * {@link MAX_OFFLINE_FIGHTS} fights, `UNSUPPORTED_RULES_VERSION`.
 */
export function resolveOfflineProgress(input: OfflineProgressInput): OfflineProgressResult {
  return resolveOfflineProgressUnder(input, getGameRules(input.rulesVersion));
}

/**
 * {@link resolveOfflineProgress} under an explicit rule set. Not exported from
 * the package: production always resolves a registered, versioned rule set.
 * Tests use it to prove the work limit holds for rules faster than any
 * registered one.
 */
export function resolveOfflineProgressUnder(
  input: OfflineProgressInput,
  rules: GameRules,
): OfflineProgressResult {
  const before = input.progress;
  requireWholeAmount(before.experience, 'experience');
  requireWholeAmount(before.gold, 'gold');
  const elapsedMs = validateElapsed(input.elapsedMs);

  const capReached = elapsedMs > rules.offline.capMs;
  const rewardedMs = capReached ? rules.offline.capMs : elapsedMs;
  const idle = (reason: OfflineIdleReason, target: Stage | null): OfflineProgressResult => ({
    rulesVersion: rules.version,
    seed: input.seed,
    elapsedMs,
    rewardedMs,
    capReached,
    consumedMs: 0,
    target,
    idleReason: reason,
    fights: 0,
    wins: 0,
    losses: 0,
    rewards: NO_REWARDS,
    levelsGained: 0,
    before,
    after: before,
  });

  const farmStage = offlineFarmStage(before.stages);
  if (farmStage === null) {
    return idle('NO_CLEARED_STAGE', null);
  }
  const enemy = playableEnemy(farmStage, rules);
  if (enemy === null) {
    return idle('STAGE_NOT_PLAYABLE', null);
  }
  if (rewardedMs < rules.offline.minimumAbsenceMs) {
    return idle('TOO_SOON', enemy.stage);
  }

  const winRewards = calculateStageRewards(enemy.stage, rules.rewards);
  let level = before.level;
  let character: Character = createCharacter(level, rules);
  let experience = before.experience;
  let gold = before.gold;
  let goldEarned = HugeNumber.ZERO;
  let experienceEarned = HugeNumber.ZERO;
  let consumedMs = 0;
  let fights = 0;
  let wins = 0;

  for (;;) {
    const combat = simulateCombat({
      player: character,
      enemy,
      seed: deriveSeed(input.seed, 'offline', fights),
      rulesVersion: rules.version,
    });
    // Every combat lasts at least until the first attack lands, so time is
    // consumed on every iteration and the loop ends.
    if (combat.durationMs > rewardedMs - consumedMs) {
      break;
    }
    if (fights === MAX_OFFLINE_FIGHTS) {
      throw new GameCoreError(
        'LIMIT_EXCEEDED',
        `Offline progression would exceed ${String(MAX_OFFLINE_FIGHTS)} fights in one claim.`,
      );
    }
    consumedMs += combat.durationMs;
    fights += 1;

    if (combat.outcome === 'WIN') {
      wins += 1;
      gold = gold.add(winRewards.gold);
      goldEarned = goldEarned.add(winRewards.gold);
      experienceEarned = experienceEarned.add(winRewards.experience);
      const leveled = applyExperience(
        { level, experience },
        winRewards.experience,
        rules.progression,
      );
      experience = leveled.experience;
      if (leveled.level !== level) {
        level = leveled.level;
        character = createCharacter(level, rules);
      }
    }
  }

  return {
    rulesVersion: rules.version,
    seed: input.seed,
    elapsedMs,
    rewardedMs,
    capReached,
    consumedMs,
    target: enemy.stage,
    idleReason: null,
    fights,
    wins,
    losses: fights - wins,
    rewards: { gold: goldEarned, experience: experienceEarned },
    levelsGained: level - before.level,
    before,
    after: { level, experience, gold, stages: before.stages },
  };
}
