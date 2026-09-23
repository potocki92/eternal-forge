export { MAX_LEVELS_PER_GAIN, applyExperience, experienceToNextLevel } from './level.js';
export type { ExperienceGainResult, LevelProgress } from './level.js';
export { describeProgress, resolveStageAttempt } from './stage-attempt.js';
export {
  INITIAL_STAGE_MODE,
  INITIAL_STAGE_PROGRESS,
  STAGE_MODES,
  advanceStageProgress,
  createStageProgress,
  selectStage,
} from './stage-progress.js';
export type { StageMode, StageProgress, StageSelection } from './stage-progress.js';
export type {
  CharacterProgress,
  ProgressDescription,
  StageAttemptInput,
  StageAttemptResult,
} from './stage-attempt.js';
