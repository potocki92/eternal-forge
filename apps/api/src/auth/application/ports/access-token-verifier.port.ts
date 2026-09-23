import type { AuthenticatedIdentity } from '../authenticated-identity.js';

/**
 * Application port: turns a bearer access token into an identity, or refuses.
 *
 * The production adapter verifies Supabase-issued JWTs locally (ADR-016).
 * Tests use the same adapter with locally generated keys rather than a mock, so
 * the verification rules under test are the ones that run in production.
 */
export interface AccessTokenVerifier {
  /**
   * @throws {AccessTokenRejectedError} when the token is not acceptable.
   * @throws {AccessTokenVerificationUnavailableError} when acceptability cannot be
   *   determined right now (signing keys unreachable).
   */
  verify(token: string): Promise<AuthenticatedIdentity>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export type AccessTokenRejection = 'expired' | 'invalid';

/** The token is definitively unacceptable. The client must obtain a new one. */
export class AccessTokenRejectedError extends Error {
  constructor(readonly reason: AccessTokenRejection) {
    super(`Access token rejected: ${reason}`);
    this.name = 'AccessTokenRejectedError';
  }
}

/**
 * Verification could not be performed. Distinct from rejection so a transient
 * outage of the key endpoint does not sign every player out.
 */
export class AccessTokenVerificationUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Access token verification is temporarily unavailable', options);
    this.name = 'AccessTokenVerificationUnavailableError';
  }
}
