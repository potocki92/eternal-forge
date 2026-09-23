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
