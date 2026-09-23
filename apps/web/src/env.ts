import { parsePublicEnv, type PublicEnv } from '@eternal-forge/config/client';

/**
 * Browser-visible configuration for this application.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only where the property access is
 * statically visible, hence the explicit object literal. Validating here means a
 * malformed value fails the build instead of producing a broken fetch at
 * runtime.
 *
 * Only public values belong here: the Supabase *anon* key is designed to be
 * shipped to browsers. The service-role key is never read by this application.
 */
export const env: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
