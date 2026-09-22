import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadApiEnv, loadWorkerEnv, workerEnvSchema } from './server.js';
import { EnvValidationError } from './env-error.js';

const validApiEnv = {
  DATABASE_URL: 'postgresql://forge:forge@localhost:5432/eternal_forge',
  REDIS_URL: 'redis://localhost:6379',
  SUPABASE_URL: 'https://project.supabase.co',
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

  it('never requires the service-role key: tokens are verified with public keys', () => {
    expect(Object.keys(apiEnvSchema.shape)).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('requires SUPABASE_URL to know which issuer to trust', () => {
    const { SUPABASE_URL: _omitted, ...withoutSupabase } = validApiEnv;

    expect(apiEnvSchema.safeParse(withoutSupabase).success).toBe(false);
  });

  it('defaults the expected audience and leaves the legacy secret unset', () => {
    const env = apiEnvSchema.parse(validApiEnv);

    expect(env.AUTH_JWT_AUDIENCE).toBe('authenticated');
    expect(env.SUPABASE_JWT_SECRET).toBeUndefined();
  });

  it('rejects a short legacy JWT secret', () => {
    const result = apiEnvSchema.safeParse({ ...validApiEnv, SUPABASE_JWT_SECRET: 'short' });

    expect(result.success).toBe(false);
  });

  it('refuses a plain-HTTP key source in production', () => {
    const result = apiEnvSchema.safeParse({
      ...validApiEnv,
      NODE_ENV: 'production',
      SUPABASE_URL: 'http://auth.internal:9999',
    });

    expect(result.success).toBe(false);
  });

  it('allows a plain-HTTP key source for local development', () => {
    const result = apiEnvSchema.safeParse({
      ...validApiEnv,
      SUPABASE_URL: 'http://127.0.0.1:54329',
    });

    expect(result.success).toBe(true);
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
