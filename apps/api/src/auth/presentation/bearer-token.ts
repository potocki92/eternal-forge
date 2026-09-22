/** Upper bound on an accepted token. Supabase access tokens are well under 2 KiB. */
const MAX_TOKEN_LENGTH = 8_192;

/** `Bearer <compact JWS>`: three base64url segments. */
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

export type BearerExtraction =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'present'; readonly token: string };

/**
 * Reads the access token from the `Authorization` header only.
 *
 * Tokens are never accepted from query strings (they end up in access logs and
 * browser history) or cookies (which would make every endpoint a CSRF target).
 */
export function extractBearerToken(header: string | undefined): BearerExtraction {
  if (header === undefined || header.length === 0) {
    return { kind: 'missing' };
  }
  if (header.length > MAX_TOKEN_LENGTH + 'Bearer '.length) {
    return { kind: 'malformed' };
  }

  const match = BEARER_PATTERN.exec(header);
  const token = match?.[1];

  return token === undefined ? { kind: 'malformed' } : { kind: 'present', token };
}
