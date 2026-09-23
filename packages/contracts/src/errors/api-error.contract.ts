import { z } from 'zod';

/**
 * Machine-readable reasons the API reports alongside an HTTP status.
 *
 * Clients branch on `code`, never on the human-readable `error` text.
 */
export const API_ERROR_CODES = [
  /** No, malformed, expired or otherwise unverifiable access token. */
  'UNAUTHENTICATED',
  /** The caller is authenticated but has no profile/character yet. */
  'PLAYER_NOT_PROVISIONED',
  /** The resource does not exist *for this caller*. Never distinguishes "someone else's". */
  'NOT_FOUND',
  'VALIDATION_FAILED',
  /**
   * The character is still fighting its previous combat (ADR-019, "Pacing").
   * Retry after the `Retry-After` header, or after `progression.nextCombatAt`.
   */
  'COMBAT_NOT_READY',
  /**
   * The character's current stage is a valid stage number, but it lies beyond
   * what the rule set can scale into an enemy. No combat is possible there.
   */
  'STAGE_NOT_PLAYABLE',
  /**
   * The API cannot verify credentials right now (e.g. the signing-key endpoint
   * is unreachable). Retry later; this does not mean the session is invalid.
   */
  'AUTH_UNAVAILABLE',
  'INTERNAL_ERROR',
  /** Any other HTTP error without a more specific code. */
  'HTTP_ERROR',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorIssueSchema = z.object({
  /** Dotted path of the offending field, e.g. `displayName`. */
  path: z.string(),
  message: z.string(),
});
export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;

/** The body of every non-2xx API response. Never contains stack traces or SQL. */
export const apiErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  code: apiErrorCodeSchema,
  error: z.string(),
  requestId: z.string().optional(),
  issues: z.array(apiErrorIssueSchema).optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
