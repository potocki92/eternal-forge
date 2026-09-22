import { z } from 'zod';
import { urlWithProtocol } from './primitives.js';

const POSTGRES_PROTOCOLS = ['postgres:', 'postgresql:'] as const;

/**
 * `DATABASE_URL` is the pooled connection used at runtime.
 * `DIRECT_URL` bypasses the pooler and is required by Prisma Migrate; Supabase
 * exposes both, and migrations against a transaction pooler will fail.
 */
export const databaseEnvSchema = z.object({
  DATABASE_URL: urlWithProtocol(POSTGRES_PROTOCOLS, 'PostgreSQL'),
  DIRECT_URL: urlWithProtocol(POSTGRES_PROTOCOLS, 'PostgreSQL').optional(),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
