import type { z } from 'zod';
import { loadEnvFiles } from './dotenv.js';
import { memoize, parseEnv, type EnvSource } from './parse.js';
import { isBrowserRuntime } from './runtime.js';
import { coreEnvSchema } from './schemas/core.js';
import { databaseEnvSchema } from './schemas/database.js';
import { boundedInt, csvList, port } from './schemas/primitives.js';
import { redisEnvSchema } from './schemas/redis.js';
import { supabaseAuthEnvSchema, supabaseServerEnvSchema } from './schemas/supabase-server.js';

if (isBrowserRuntime()) {
  throw new Error(
    '@eternal-forge/config/server was imported in a browser context. ' +
      'Server configuration contains privileged credentials; use @eternal-forge/config/client instead.',
  );
}

export const apiEnvSchema = coreEnvSchema
  .extend({
    API_PORT: port(3001),
    // Both loopback spellings by default: a developer browsing 127.0.0.1 and a
    // developer browsing localhost are different origins to the browser.
    API_CORS_ORIGINS: csvList.prefault('http://localhost:3000,http://127.0.0.1:3000'),
  })
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(supabaseAuthEnvSchema.shape)
  .superRefine((env, context) => {
    // Signing keys are fetched from SUPABASE_URL. Over plain HTTP an on-path
    // attacker could substitute their own keys and mint valid sessions.
    if (env.NODE_ENV === 'production' && !env.SUPABASE_URL.startsWith('https:')) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'must use https in production',
      });
    }
  });

export const workerEnvSchema = coreEnvSchema
  .extend({
    // Upper bound is a guard against a typo turning into thousands of
    // concurrent jobs against one Redis connection.
    WORKER_CONCURRENCY: boundedInt(1, 1, 64),
  })
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type SupabaseServerEnv = z.infer<typeof supabaseServerEnvSchema>;

export const loadApiEnv = makeLoader('apps/api', apiEnvSchema);
export const loadWorkerEnv = makeLoader('apps/worker', workerEnvSchema);

/**
 * The service-role credential is validated lazily, at the point a privileged
 * client is constructed, rather than at process start.
 *
 * No Phase 2 process needs it: the API verifies access tokens with public
 * signing keys (ADR-016). Keeping it out of {@link apiEnvSchema} means the API
 * can run — and does run — without a credential that bypasses Row Level
 * Security.
 */
export const loadSupabaseServerEnv = makeLoader('supabase (server)', supabaseServerEnvSchema);

function makeLoader<TSchema extends z.ZodType<object, EnvSource>>(
  context: string,
  schema: TSchema,
) {
  const cached = memoize(() => parseEnv(context, schema, process.env));

  /**
   * @param source Overrides `process.env`. Supplying a source bypasses the cache,
   *   which keeps tests isolated from one another.
   */
  return (source?: EnvSource): z.output<TSchema> =>
    source === undefined ? cached() : parseEnv(context, schema, source);
}

export { loadEnvFiles };
export { EnvValidationError } from './env-error.js';
export type { EnvIssue } from './env-error.js';
