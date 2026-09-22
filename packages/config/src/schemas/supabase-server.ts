import { z } from 'zod';
import { secret, urlWithProtocol } from './primitives.js';

/**
 * Privileged Supabase configuration.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security and must never be
 * exposed to a browser bundle (docs/SECURITY.md — "Supabase").
 */
export const supabaseServerEnvSchema = z.object({
  SUPABASE_URL: urlWithProtocol(['https:', 'http:'], 'Supabase'),
  SUPABASE_SERVICE_ROLE_KEY: secret(),
});

export type SupabaseServerEnv = z.infer<typeof supabaseServerEnvSchema>;

/**
 * Access-token verification settings for a server that accepts Supabase
 * sessions (ADR-016).
 *
 * The API verifies tokens locally, so it needs where tokens come from, not a
 * privileged credential: `SUPABASE_URL` determines the expected issuer
 * (`<url>/auth/v1`) and the JWKS endpoint for asymmetric signing keys.
 * `SUPABASE_JWT_SECRET` is only for projects still signing with the legacy
 * shared HS256 secret; leave it unset otherwise so HS256 tokens are refused.
 */
export const supabaseAuthEnvSchema = z.object({
  SUPABASE_URL: urlWithProtocol(['https:', 'http:'], 'Supabase'),
  SUPABASE_JWT_SECRET: secret(32).optional(),
  /** Expected `aud` claim. Supabase issues `authenticated` for signed-in users. */
  AUTH_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
});

export type SupabaseAuthEnv = z.infer<typeof supabaseAuthEnvSchema>;
