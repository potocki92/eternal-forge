import { isBrowserRuntime } from '@eternal-forge/config';
import { createClient } from '@supabase/supabase-js';

export interface SupabaseAdminOptions {
  readonly url: string;
  /**
   * Service role key. Bypasses Row Level Security; it must exist only in
   * server-side processes (docs/SECURITY.md — "Supabase").
   */
  readonly serviceRoleKey: string;
}

export interface SupabasePublicOptions {
  readonly url: string;
  /** Anon key. Safe to ship to a browser bundle. */
  readonly anonKey: string;
}

/**
 * Privileged Supabase client for server-side processes.
 *
 * Session persistence and token auto-refresh are disabled: a server process has
 * no user session to persist, and leaving them on causes a background timer plus
 * credential storage nothing reads.
 */
export function createSupabaseAdminClient(options: SupabaseAdminOptions) {
  if (isBrowserRuntime()) {
    throw new Error('The Supabase service-role client must never be constructed in a browser.');
  }

  return createClient(options.url, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Browser-safe Supabase client, scoped by Row Level Security to the signed-in user.
 *
 * The return type is inferred from `createClient` so the generated database
 * generics stay attached rather than being widened to a bare `SupabaseClient`.
 */
export function createSupabasePublicClient(options: SupabasePublicOptions) {
  return createClient(options.url, options.anonKey);
}
