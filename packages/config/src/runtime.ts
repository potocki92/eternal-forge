/**
 * Detects a browser runtime without referencing DOM globals in a Node type
 * environment.
 *
 * Used to fail fast when privileged, server-only code is pulled into a client
 * bundle (docs/SECURITY.md — "Supabase").
 */
export function isBrowserRuntime(): boolean {
  return typeof globalThis === 'object' && 'window' in globalThis;
}
