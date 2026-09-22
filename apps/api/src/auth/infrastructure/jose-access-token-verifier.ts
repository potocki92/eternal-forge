import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTHeaderParameters,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { Clock } from '../../common/clock/clock.port.js';
import type { AuthenticatedIdentity } from '../application/authenticated-identity.js';
import {
  AccessTokenRejectedError,
  AccessTokenVerificationUnavailableError,
  type AccessTokenVerifier,
} from '../application/ports/access-token-verifier.port.js';

/** Asymmetric algorithms Supabase signing keys use. `none` is never accepted. */
const ASYMMETRIC_ALGORITHMS = ['ES256', 'RS256'] as const;
const LEGACY_SYMMETRIC_ALGORITHM = 'HS256';

/** Tolerated skew between our clock and Supabase's, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 5;

/** Role Supabase assigns to a signed-in user. `anon` and `service_role` are refused. */
const AUTHENTICATED_ROLE = 'authenticated';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface JoseAccessTokenVerifierOptions {
  /** Expected `iss`, i.e. `<SUPABASE_URL>/auth/v1`. */
  readonly issuer: string;
  /** Expected `aud`, normally `authenticated`. */
  readonly audience: string;
  /** Public signing keys, normally {@link createSupabaseJwks}. */
  readonly keys: JWTVerifyGetKey;
  /**
   * Legacy shared HS256 secret. When absent, HS256 tokens are refused outright,
   * which rules out algorithm-confusion attacks against the public keys.
   */
  readonly legacySecret?: string;
  readonly clock: Clock;
}

/**
 * Verifies Supabase access tokens locally: signature, algorithm allow-list,
 * issuer, audience, expiry, subject and role.
 *
 * No network round trip per request — only the public key set is fetched and
 * cached. The trade-off (ADR-016): a token stays valid until it expires even if
 * its session was revoked, so the access-token lifetime bounds that window.
 */
export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly algorithms: readonly string[];
  private readonly secretKey: Uint8Array | undefined;

  constructor(private readonly options: JoseAccessTokenVerifierOptions) {
    this.secretKey =
      options.legacySecret === undefined
        ? undefined
        : new TextEncoder().encode(options.legacySecret);
    this.algorithms =
      this.secretKey === undefined
        ? ASYMMETRIC_ALGORITHMS
        : [...ASYMMETRIC_ALGORITHMS, LEGACY_SYMMETRIC_ALGORITHM];
  }

  async verify(token: string): Promise<AuthenticatedIdentity> {
    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(token, this.resolveKey, {
        algorithms: [...this.algorithms],
        issuer: this.options.issuer,
        audience: this.options.audience,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: this.options.clock.now(),
      }));
    } catch (error) {
      throw translate(error);
    }

    return toIdentity(payload);
  }

  private readonly resolveKey = (
    header: JWTHeaderParameters,
    token: Parameters<JWTVerifyGetKey>[1],
  ): ReturnType<JWTVerifyGetKey> | Uint8Array => {
    if (header.alg === LEGACY_SYMMETRIC_ALGORITHM) {
      if (this.secretKey === undefined) {
        throw new AccessTokenRejectedError('invalid');
      }
      return this.secretKey;
    }
    return this.options.keys(header, token);
  };
}

/** The Supabase project's published public key set, fetched lazily and cached. */
export function createSupabaseJwks(supabaseUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(
    new URL('auth/v1/.well-known/jwks.json', withTrailingSlash(supabaseUrl)),
    {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    },
  );
}

export function supabaseIssuer(supabaseUrl: string): string {
  return new URL('auth/v1', withTrailingSlash(supabaseUrl)).toString();
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function toIdentity(payload: JWTPayload): AuthenticatedIdentity {
  const { sub } = payload;
  const role = payload['role'];
  const sessionId = payload['session_id'];

  if (sub === undefined || !UUID_PATTERN.test(sub)) {
    throw new AccessTokenRejectedError('invalid');
  }
  if (role !== AUTHENTICATED_ROLE) {
    throw new AccessTokenRejectedError('invalid');
  }
  // Anonymous sign-in is not part of the product; its tokens also carry the
  // `authenticated` role, so they are refused explicitly.
  if (payload['is_anonymous'] === true) {
    throw new AccessTokenRejectedError('invalid');
  }

  return {
    authUserId: sub.toLowerCase(),
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
  };
}

function translate(error: unknown): Error {
  if (error instanceof AccessTokenRejectedError) {
    return error;
  }
  if (error instanceof errors.JWTExpired) {
    return new AccessTokenRejectedError('expired');
  }
  // Key-set transport failures say nothing about the token itself: a timeout,
  // a network error, a non-200 or unparsable key-set response (which jose
  // reports as the generic JOSEError) or an invalid key set.
  if (
    !(error instanceof errors.JOSEError) ||
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    error.code === 'ERR_JOSE_GENERIC'
  ) {
    return new AccessTokenVerificationUnavailableError({ cause: error });
  }
  return new AccessTokenRejectedError('invalid');
}
