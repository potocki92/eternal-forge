import { z } from 'zod';
import { parseEnv, type EnvSource } from './parse.js';
import { urlWithProtocol } from './schemas/primitives.js';
import { supabasePublicEnvSchema } from './schemas/supabase.js';

/**
 * Browser-visible configuration for apps/web.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when the property access is
 * statically visible in application source, so callers must pass an explicit
 * object literal rather than handing over `process.env`.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: urlWithProtocol(['http:', 'https:'], 'API').default('http://localhost:3001'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: EnvSource): PublicEnv {
  return parseEnv('apps/web (public)', publicEnvSchema, source);
}

export { supabasePublicEnvSchema };
export type { SupabasePublicEnv } from './schemas/supabase.js';
export { EnvValidationError } from './env-error.js';
export type { EnvIssue } from './env-error.js';
