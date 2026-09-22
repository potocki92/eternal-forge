import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';

/** Where supabase-js keeps the session. Shared by every tab of this origin. */
export const AUTH_STORAGE_KEY = 'eternal-forge.auth';

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client, used for authentication only (ADR-016).
 *
 * Game data never flows through it: the browser reads and writes gameplay state
 * through the API, which verifies the access token this client obtains.
 *
 * - `persistSession` keeps the session across reloads and new tabs.
 * - `autoRefreshToken` renews the access token before it expires.
 * - supabase-js broadcasts sign-in/sign-out between tabs of the same origin.
 */
export function getSupabaseClient(): SupabaseClient {
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}
