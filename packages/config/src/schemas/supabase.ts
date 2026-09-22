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

/** Configuration that is safe to ship to a browser bundle. */
export const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlWithProtocol(['https:', 'http:'], 'Supabase'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secret(),
});

export type SupabaseServerEnv = z.infer<typeof supabaseServerEnvSchema>;
export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
