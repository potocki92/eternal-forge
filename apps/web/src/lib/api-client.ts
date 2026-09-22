import {
  livenessResponseSchema,
  readinessResponseSchema,
  type LivenessResponse,
  type ReadinessResponse,
} from '@eternal-forge/contracts';
import type { z } from 'zod';
import { env } from '@/env';

/** Raised when the API cannot be reached or answered with something unusable. */
export class ApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
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

/**
 * Performs a typed GET against the API.
 *
 * Every response is validated against the shared contract: the client renders
 * whatever the server says, but it does not assume the payload's shape
 * (CLAUDE.md — "Shared contracts").
 */
export async function getJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<z.infer<TSchema>> {
  const baseUrl = options.baseUrl ?? env.NEXT_PUBLIC_API_URL;
  const accepted = options.acceptStatus ?? [200];

  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw new ApiError('The service could not be reached.', undefined, { cause });
  }

  if (!accepted.includes(response.status)) {
    throw new ApiError('The service returned an unexpected response.', response.status);
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError('The service returned a response this client cannot read.', response.status);
  }

  return parsed.data;
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
