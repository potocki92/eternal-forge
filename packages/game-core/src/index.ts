/**
 * Eternal Forge game core.
 *
 * Pure, deterministic gameplay rules. This package must remain free of
 * frameworks, I/O and ambient state so it can be executed inside a unit test,
 * inside the API process and inside a background worker with identical results
 * (CLAUDE.md — "Game Core").
 */
export { GameCoreError } from './errors.js';
export type { GameCoreErrorCode } from './errors.js';

export {
  HUGE_NUMBER_MAX_EXPONENT,
  HUGE_NUMBER_MIN_EXPONENT,
  HUGE_NUMBER_PRECISION,
  HUGE_NUMBER_ZERO_EXPONENT,
  HugeNumber,
} from './huge-number/index.js';
export type { HugeNumberParts } from './huge-number/index.js';

export { MAX_SEED_LENGTH, Xoshiro128StarStar, createRng, deriveSeed } from './rng/index.js';
export type { Rng, RngState } from './rng/index.js';

export { GAME_RULES_VERSION } from './rules-version.js';
export type { GameRulesVersion } from './rules-version.js';
export { getGameRules, supportedRulesVersions } from './rules/index.js';
export type {
  CharacterRules,
  CombatRules,
  EnemyArchetype,
  GameRules,
  OfflineRules,
  ProgressionRules,
  RewardRules,
  StageRules,
} from './rules/index.js';

export { BASIS_POINTS, applyCombatCaps, validateCombatStats } from './stats/combat-stats.js';
export type { CombatStats } from './stats/combat-stats.js';

export { CHARACTER_LEVEL_MAX, createCharacter, validateLevel } from './character/character.js';
export type { Character } from './character/character.js';

export { createEnemyForStage } from './enemy/enemy.js';
export type { Enemy } from './enemy/enemy.js';

export {
  STAGE_NUMBER_MAX,
  StageNumber,
  enemyStatsForStage,
  resolveStage,
  scaleByStage,
} from './stage/index.js';
export type { Stage, StageKind } from './stage/index.js';

export { NO_REWARDS, addRewards, calculateStageRewards } from './rewards/rewards.js';
export type { StageRewards } from './rewards/rewards.js';

export { calculateHitDamage, simulateCombat } from './combat/index.js';
export type {
  CombatEndReason,
  CombatEvent,
  CombatOutcome,
  CombatResult,
  CombatSide,
  CombatantSummary,
  Combatant,
  SimulateCombatInput,
} from './combat/index.js';

export { MAX_STAGES_PER_SIMULATION, simulateStages } from './simulation/simulate-stages.js';
export type {
  SimulateStagesInput,
  StageRunEntry,
  StageRunResult,
  StageRunStopReason,
} from './simulation/simulate-stages.js';

export {
  INITIAL_STAGE_MODE,
  INITIAL_STAGE_PROGRESS,
  MAX_LEVELS_PER_GAIN,
  STAGE_MODES,
  advanceStageProgress,
  applyExperience,
  createStageProgress,
  describeProgress,
  experienceToNextLevel,
  resolveStageAttempt,
  selectStage,
} from './progression/index.js';
export type {
  CharacterProgress,
  ExperienceGainResult,
  LevelProgress,
  ProgressDescription,
  StageAttemptInput,
  StageAttemptResult,
  StageMode,
  StageProgress,
  StageSelection,
} from './progression/index.js';

export { MAX_OFFLINE_FIGHTS, offlineFarmStage, resolveOfflineProgress } from './offline/index.js';
export type {
  OfflineIdleReason,
  OfflineProgressInput,
  OfflineProgressResult,
} from './offline/index.js';
