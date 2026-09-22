import { z } from 'zod';

/**
 * Transport contract for the API health endpoints.
 *
 * Shared by apps/api (response shape) and apps/web (response parsing) so the two
 * sides cannot drift — see CLAUDE.md, "Shared contracts".
 */

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

/** Liveness: the process is running. Intentionally free of dependency checks. */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  /** Server time, ISO-8601. The server clock is authoritative (docs/SECURITY.md). */
  serverTime: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const dependencyStatusSchema = z.object({
  name: z.string().min(1),
  status: healthStatusSchema,
  /** Round-trip duration of the probe in milliseconds. */
  durationMs: z.number().nonnegative(),
  /** Safe, non-sensitive failure summary. Never a driver stack trace. */
  detail: z.string().optional(),
});
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** Readiness: the process can serve traffic, including its dependencies. */
export const readinessResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  serverTime: z.iso.datetime(),
  dependencies: z.array(dependencyStatusSchema),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
