/**
 * Shared transport contracts between apps/web, apps/api and apps/worker.
 *
 * Contracts describe the wire format only. They are not domain entities and not
 * persistence models (CLAUDE.md — "Persistence").
 */
export {
  dependencyStatusSchema,
  healthStatusSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from './health/health.contract.js';
export type {
  DependencyStatus,
  HealthStatus,
  LivenessResponse,
  ReadinessResponse,
} from './health/health.contract.js';

export {
  API_ERROR_CODES,
  apiErrorCodeSchema,
  apiErrorIssueSchema,
  apiErrorResponseSchema,
} from './errors/api-error.contract.js';
export type { ApiErrorCode, ApiErrorIssue, ApiErrorResponse } from './errors/api-error.contract.js';

export {
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_NAME_MIN_LENGTH,
  normalizePlayerName,
  playerNameProblem,
  playerNameSchema,
} from './player/player-name.js';
export {
  characterResponseSchema,
  characterSchema,
  playerStateResponseSchema,
  profileSchema,
  provisionPlayerRequestSchema,
} from './player/player.contract.js';
export type {
  CharacterDto,
  CharacterResponse,
  PlayerStateResponse,
  ProfileDto,
  ProvisionPlayerRequest,
} from './player/player.contract.js';

export { STAGE_NUMBER_WIRE_MAX, stageNumberSchema } from './stage/stage-number.contract.js';
export type { StageNumberDto } from './stage/stage-number.contract.js';

export { hugeAmountSchema, hugeNumberSchema } from './huge-number/huge-number.contract.js';
export type { HugeNumberDto } from './huge-number/huge-number.contract.js';

export {
  encounterSchema,
  enemySchema,
  heroStatsSchema,
  progressionSchema,
  stageKindSchema,
  stageModeSchema,
  stageProgressSchema,
  stageSchema,
} from './game/progression.contract.js';
export type {
  EncounterDto,
  EnemyDto,
  HeroStatsDto,
  ProgressionDto,
  StageDto,
  StageKind,
  StageModeDto,
  StageProgressDto,
} from './game/progression.contract.js';

export {
  stageSelectionRequestSchema,
  stageSelectionResponseSchema,
} from './game/stage-selection.contract.js';
export type {
  StageSelectionRequest,
  StageSelectionResponse,
} from './game/stage-selection.contract.js';

export {
  IDEMPOTENCY_KEY_HEADER,
  combatEndReasonSchema,
  combatEventSchema,
  combatOutcomeSchema,
  combatResponseSchema,
  combatSchema,
  idempotencyKeySchema,
  progressSnapshotSchema,
  rewardsSchema,
} from './combat/combat.contract.js';
export type {
  CombatDto,
  CombatEndReasonDto,
  CombatEventDto,
  CombatOutcomeDto,
  CombatResponse,
  ProgressSnapshotDto,
  RewardsDto,
} from './combat/combat.contract.js';

export {
  offlineIdleReasonSchema,
  offlineProgressResponseSchema,
  offlineProgressSchema,
} from './game/offline-progress.contract.js';
export type {
  OfflineIdleReasonDto,
  OfflineProgressDto,
  OfflineProgressResponse,
} from './game/offline-progress.contract.js';
