import {
  apiErrorResponseSchema,
  livenessResponseSchema,
  readinessResponseSchema,
  type ApiErrorCode,
  type LivenessResponse,
  type ReadinessResponse,
} from '@eternal-forge/contracts';
import type { z } from 'zod';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { env } from '@/env';

/** Raised when the API cannot be reached or answered with something unusable. */
export class ApiError extends Error {
  readonly status: number | undefined;
  /** Machine-readable reason from the shared error contract, when the API sent one. */
  readonly code: ApiErrorCode | undefined;

  constructor(
    message: string,
    status?: number,
    options?: ErrorOptions & { readonly code?: ApiErrorCode },
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.code = options?.code;
  }
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Overrides the base URL; used by tests and server-side rendering. */
  readonly baseUrl?: string;
  /**
   * Status codes to treat as a successful, parseable response. Readiness
   * answers 503 with a meaningful body.
   */
  readonly acceptStatus?: readonly number[];
}

export interface JsonRequest<TSchema extends z.ZodType> extends RequestOptions {
  readonly path: string;
  readonly schema: TSchema;
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly accessToken?: string;
}

/**
 * Performs a typed request against the API.
 *
 * Every response is validated against the shared contract: the client renders
 * whatever the server says, but it does not assume the payload's shape
 * (CLAUDE.md — "Shared contracts"). Error messages shown to players are written
 * here or by the API's error contract, never taken from a transport exception.
 */
export async function requestJson<TSchema extends z.ZodType>(
  request: JsonRequest<TSchema>,
): Promise<z.infer<TSchema>> {
  const baseUrl = request.baseUrl ?? env.NEXT_PUBLIC_API_URL;
  const accepted = request.acceptStatus ?? [200];
  const headers: Record<string, string> = { accept: 'application/json' };
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (request.accessToken !== undefined) {
    headers.authorization = `Bearer ${request.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(new URL(request.path, baseUrl), {
      method: request.method ?? 'GET',
      headers,
      cache: 'no-store',
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (cause) {
    throw new ApiError('The service could not be reached.', undefined, { cause });
  }

  if (!accepted.includes(response.status)) {
    throw await errorFrom(response);
  }

  const payload: unknown = await response.json();
  const parsed = request.schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError('The service returned a response this client cannot read.', response.status);
  }

  return parsed.data;
}

/** Performs a typed GET against the API. */
export function getJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<z.infer<TSchema>> {
  return requestJson({ ...options, path, schema });
}

/**
 * A request on behalf of the signed-in player.
 *
 * On 401 the access token is refreshed once and the request retried — covering
 * a token that expired in flight or a rotated signing key. If the API still
 * refuses, or the session cannot be refreshed, the session is ended locally so
 * the player is sent to sign-in instead of looking at a broken screen.
 */
export async function authorizedJson<TSchema extends z.ZodType>(
  tokens: AccessTokenSource,
  request: Omit<JsonRequest<TSchema>, 'accessToken'>,
): Promise<z.infer<TSchema>> {
  const token = await tokens.getAccessToken();
  if (token === null) {
    throw sessionEnded();
  }

  try {
    return await requestJson({ ...request, accessToken: token });
  } catch (error) {
    if (!isUnauthenticated(error)) {
      throw error;
    }
  }

  const refreshed = await tokens.refreshAccessToken();
  if (refreshed === null) {
    await tokens.expireSession();
    throw sessionEnded();
  }

  try {
    return await requestJson({ ...request, accessToken: refreshed });
  } catch (error) {
    if (isUnauthenticated(error)) {
      await tokens.expireSession();
    }
    throw error;
  }
}

export function fetchLiveness(options?: RequestOptions): Promise<LivenessResponse> {
  return getJson('/health', livenessResponseSchema, options);
}

export function fetchReadiness(options?: RequestOptions): Promise<ReadinessResponse> {
  return getJson('/health/ready', readinessResponseSchema, {
    ...options,
    // 503 is a valid, informative readiness answer, not a transport failure.
    acceptStatus: [200, 503],
  });
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function sessionEnded(): ApiError {
  return new ApiError('Your session has ended. Please sign in again.', 401, {
    code: 'UNAUTHENTICATED',
  });
}

async function errorFrom(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const parsed = apiErrorResponseSchema.safeParse(payload);

  if (parsed.success && response.status < 500) {
    return new ApiError(parsed.data.error, response.status, { code: parsed.data.code });
  }
  return new ApiError(
    'The service returned an unexpected response.',
    response.status,
    parsed.success ? { code: parsed.data.code } : {},
  );
}
