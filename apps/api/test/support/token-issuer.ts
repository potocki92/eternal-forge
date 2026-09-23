import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export const TEST_SUPABASE_URL = 'https://test-project.supabase.co';
export const TEST_ISSUER = `${TEST_SUPABASE_URL}/auth/v1`;
export const TEST_AUDIENCE = 'authenticated';
export const TEST_LEGACY_SECRET = 'legacy-hs256-secret-for-tests-only-0123456789';

export interface IssueOptions {
  readonly sub?: string;
  readonly claims?: JWTPayload;
  /** Seconds relative to `now`. Negative issues an already expired token. */
  readonly expiresInSeconds?: number;
  readonly issuer?: string;
  readonly audience?: string;
  readonly now?: Date;
}

/**
 * Issues access tokens shaped like Supabase's, signed with keys generated for
 * the test run. The API's real verifier checks them against the matching
 * public key set — nothing about verification is mocked.
 */
export class TestTokenIssuer {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly kid: string,
    readonly jwks: JWTVerifyGetKey,
    readonly publicJwk: JWK,
  ) {}

  static async create(): Promise<TestTokenIssuer> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const kid = randomUUID();
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

    return new TestTokenIssuer(
      privateKey,
      kid,
      createLocalJWKSet({ keys: [publicJwk] }),
      publicJwk,
    );
  }

  issue(options: IssueOptions = {}): Promise<string> {
    return new SignJWT(supabaseClaims(options))
      .setProtectedHeader({ alg: 'ES256', kid: this.kid, typ: 'JWT' })
      .sign(this.privateKey);
  }

  /** Signed with the legacy shared secret, as older Supabase projects do. */
  static issueLegacy(options: IssueOptions = {}, secret = TEST_LEGACY_SECRET): Promise<string> {
    return new SignJWT(supabaseClaims(options))
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(new TextEncoder().encode(secret));
  }
}

function supabaseClaims(options: IssueOptions): JWTPayload {
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);

  return {
    iss: options.issuer ?? TEST_ISSUER,
    aud: options.audience ?? TEST_AUDIENCE,
    sub: options.sub ?? randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + (options.expiresInSeconds ?? 3600),
    role: 'authenticated',
    aal: 'aal1',
    session_id: randomUUID(),
    is_anonymous: false,
    email: 'player@example.test',
    ...options.claims,
  };
}
