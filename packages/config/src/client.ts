import { z } from 'zod';
import { parseEnv, type EnvSource } from './parse.js';
import { urlWithProtocol } from './schemas/primitives.js';
import { secret } from './schemas/primitives.js';
import { supabasePublicEnvSchema } from './schemas/supabase.js';

/**
 * Local-development defaults point at the Supabase Auth test double
 * (`pnpm --filter @eternal-forge/web run auth:stub`). A deployment against a
 * real Supabase project sets both values; the anon key is public by design.
 */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54329';
export const LOCAL_SUPABASE_ANON_KEY = 'local-development-anon-key';

/**
 * Browser-visible configuration for apps/web.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when the property access is
 * statically visible in application source, so callers must pass an explicit
 * object literal rather than handing over `process.env`.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: urlWithProtocol(['http:', 'https:'], 'API').default('http://localhost:3001'),
  NEXT_PUBLIC_SUPABASE_URL: urlWithProtocol(['http:', 'https:'], 'Supabase').default(
    LOCAL_SUPABASE_URL,
  ),
  /** The anon (publishable) key. Never the service-role key. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secret().default(LOCAL_SUPABASE_ANON_KEY),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: EnvSource): PublicEnv {
  return parseEnv('apps/web (public)', publicEnvSchema, source);
}

export { supabasePublicEnvSchema };
export type { SupabasePublicEnv } from './schemas/supabase.js';
export { EnvValidationError } from './env-error.js';
export type { EnvIssue } from './env-error.js';
