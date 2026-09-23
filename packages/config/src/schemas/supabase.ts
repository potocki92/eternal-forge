import { z } from 'zod';
import { secret, urlWithProtocol } from './primitives.js';

// Server-only Supabase schemas live in `supabase-server.ts`, so that this
// module — which reaches the browser through `@eternal-forge/config/client` —
// does not even carry the names of privileged variables.

/** Configuration that is safe to ship to a browser bundle. */
export const supabasePublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlWithProtocol(['https:', 'http:'], 'Supabase'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: secret(),
});

export type SupabasePublicEnv = z.infer<typeof supabasePublicEnvSchema>;
