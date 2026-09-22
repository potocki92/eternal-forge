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
