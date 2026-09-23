/**
 * Who the caller is, as established by a verified access token.
 *
 * This is the only source of identity in the API. Request bodies, query strings
 * and path parameters never name the acting player (docs/SECURITY.md —
 * "Authentication").
 */
export interface AuthenticatedIdentity {
  /** Supabase Auth user id (`sub`). Used only to look up the owning profile. */
  readonly authUserId: string;
  /** Supabase session id (`session_id`), when the token carries one. For logs only. */
  readonly sessionId: string | undefined;
}
