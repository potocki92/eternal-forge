import type { z } from 'zod';
import { EnvValidationError, type EnvIssue } from './env-error.js';

export type EnvSource = Record<string, string | undefined>;

/**
 * Validates an environment source against a schema.
 *
 * Throws {@link EnvValidationError} listing every failing variable at once, so a
 * misconfigured deployment surfaces all problems in a single startup failure
 * instead of one per restart.
 */
export function parseEnv<TSchema extends z.ZodType<object, EnvSource>>(
  context: string,
  schema: TSchema,
  source: EnvSource,
): z.output<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(context, toIssues(result.error));
  }

  return result.data;
}

/**
 * Memoises a loader so repeated calls during a process lifetime validate once.
 * The cache is keyed by nothing: a process has exactly one environment.
 */
export function memoize<T>(load: () => T): () => T {
  let cached: { value: T } | undefined;
  return () => {
    cached ??= { value: load() };
    return cached.value;
  };
}

function toIssues(error: z.ZodError): EnvIssue[] {
  return error.issues.map((issue) => ({
    variable: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
  }));
}
