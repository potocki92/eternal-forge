import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadApiEnv, loadWorkerEnv, workerEnvSchema } from './server.js';
import { EnvValidationError } from './env-error.js';

const validApiEnv = {
  DATABASE_URL: 'postgresql://forge:forge@localhost:5432/eternal_forge',
  REDIS_URL: 'redis://localhost:6379',
};

describe('apiEnvSchema', () => {
  it('applies documented defaults', () => {
    const env = apiEnvSchema.parse(validApiEnv);

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 3001,
      API_CORS_ORIGINS: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    const result = apiEnvSchema.safeParse({ ...validApiEnv, DATABASE_URL: 'mysql://localhost/db' });
    expect(result.success).toBe(false);
  });

  it('does not accept Supabase service credentials as part of process startup', () => {
    // Supabase lands in Phase 2; the API must boot without those variables.
    expect(Object.keys(apiEnvSchema.shape)).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('workerEnvSchema', () => {
  it('defaults concurrency to 1', () => {
    expect(workerEnvSchema.parse(validApiEnv).WORKER_CONCURRENCY).toBe(1);
  });
});

describe('loaders', () => {
  it('validate an explicit source without touching process.env', () => {
    expect(loadApiEnv(validApiEnv).API_PORT).toBe(3001);
    expect(loadWorkerEnv(validApiEnv).WORKER_CONCURRENCY).toBe(1);
  });

  it('throw a listing error for an incomplete source', () => {
    expect(() => loadApiEnv({})).toThrow(EnvValidationError);
  });
});
