/**
 * What an authenticated API call needs from the session, and nothing more.
 *
 * The API client depends on this port rather than on Supabase, so its retry and
 * expiry behaviour is testable with a plain object.
 */
export interface AccessTokenSource {
  /** The current access token (refreshed first if it is about to expire), or `null`. */
  getAccessToken(): Promise<string | null>;
  /** Force a refresh after the API rejected a token. `null` if the session is gone. */
  refreshAccessToken(): Promise<string | null>;
  /** The session cannot be recovered: end it locally so the UI returns to sign-in. */
  expireSession(): Promise<void>;
}
