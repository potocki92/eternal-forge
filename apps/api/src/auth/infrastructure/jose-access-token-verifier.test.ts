import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { SignJWT, UnsecuredJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_LEGACY_SECRET,
  TestTokenIssuer,
} from '../../../test/support/token-issuer.js';
import type { Clock } from '../../common/clock/clock.port.js';
import {
  AccessTokenRejectedError,
  AccessTokenVerificationUnavailableError,
} from '../application/ports/access-token-verifier.port.js';
import {
  JoseAccessTokenVerifier,
  createSupabaseJwks,
  supabaseIssuer,
} from './jose-access-token-verifier.js';

const systemClock: Clock = { now: () => new Date() };

let issuer: TestTokenIssuer;
let verifier: JoseAccessTokenVerifier;

beforeAll(async () => {
  issuer = await TestTokenIssuer.create();
  verifier = new JoseAccessTokenVerifier({
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    keys: issuer.jwks,
    clock: systemClock,
  });
});

async function expectRejected(token: string, reason: 'expired' | 'invalid', target = verifier) {
  const failure: unknown = await target.verify(token).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AccessTokenRejectedError);
  expect((failure as AccessTokenRejectedError).reason).toBe(reason);
}

describe('JoseAccessTokenVerifier', () => {
  it('accepts a Supabase-shaped token and returns the subject', async () => {
    const sub = randomUUID();
    const token = await issuer.issue({ sub });

    await expect(verifier.verify(token)).resolves.toMatchObject({ authUserId: sub });
  });

  it('rejects an expired token as expired', async () => {
    await expectRejected(await issuer.issue({ expiresInSeconds: -60 }), 'expired');
  });

  it('tolerates a few seconds of clock skew', async () => {
    const token = await issuer.issue({ expiresInSeconds: -2 });

    await expect(verifier.verify(token)).resolves.toBeDefined();
  });

  it('uses the injected clock, not the ambient one', async () => {
    const token = await issuer.issue({ expiresInSeconds: 60 });
    const later: Clock = { now: () => new Date(Date.now() + 3_600_000) };
    const lateVerifier = new JoseAccessTokenVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      keys: issuer.jwks,
      clock: later,
    });

    await expectRejected(token, 'expired', lateVerifier);
  });

  it('rejects a token signed by another key', async () => {
    const stranger = await TestTokenIssuer.create();

    await expectRejected(await stranger.issue(), 'invalid');
  });

  it('rejects a tampered payload', async () => {
    const token = await issuer.issue();
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: randomUUID(), role: 'authenticated' }),
    ).toString('base64url');

    await expectRejected(`${header}.${forged}.${signature}`, 'invalid');
  });

  it('rejects an unsigned (alg "none") token', async () => {
    const token = new UnsecuredJWT({ sub: randomUUID(), role: 'authenticated' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .encode();

    await expectRejected(token, 'invalid');
  });

  it('rejects a token from another issuer (e.g. another Supabase project)', async () => {
    await expectRejected(
      await issuer.issue({ issuer: 'https://other.supabase.co/auth/v1' }),
      'invalid',
    );
  });

  it('rejects a token for another audience', async () => {
    await expectRejected(await issuer.issue({ audience: 'service' }), 'invalid');
  });

  it.each(['anon', 'service_role'])('rejects the %s role', async (role) => {
    await expectRejected(await issuer.issue({ claims: { role } }), 'invalid');
  });

  it('rejects an anonymous sign-in', async () => {
    await expectRejected(await issuer.issue({ claims: { is_anonymous: true } }), 'invalid');
  });

  it('rejects a subject that is not a UUID', async () => {
    await expectRejected(await issuer.issue({ sub: '../../admin' }), 'invalid');
  });

  it('rejects garbage', async () => {
    await expectRejected('not.a.jwt', 'invalid');
  });

  describe('legacy HS256 secret', () => {
    it('refuses HS256 when no secret is configured (no algorithm confusion)', async () => {
      await expectRejected(await TestTokenIssuer.issueLegacy(), 'invalid');
    });

    it('accepts HS256 signed with the configured secret', async () => {
      const legacyVerifier = new JoseAccessTokenVerifier({
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        keys: issuer.jwks,
        legacySecret: TEST_LEGACY_SECRET,
        clock: systemClock,
      });
      const sub = randomUUID();

      await expect(
        legacyVerifier.verify(await TestTokenIssuer.issueLegacy({ sub })),
      ).resolves.toMatchObject({ authUserId: sub });
      await expectRejected(
        await TestTokenIssuer.issueLegacy({}, 'a-different-secret-of-sufficient-length-000'),
        'invalid',
        legacyVerifier,
      );
    });

    it('rejects the public anon key, which is itself an HS256 JWT', async () => {
      const legacyVerifier = new JoseAccessTokenVerifier({
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        keys: issuer.jwks,
        legacySecret: TEST_LEGACY_SECRET,
        clock: systemClock,
      });
      const anonKey = await new SignJWT({ role: 'anon', iss: 'supabase' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('10y')
        .sign(new TextEncoder().encode(TEST_LEGACY_SECRET));

      await expectRejected(anonKey, 'invalid', legacyVerifier);
    });
  });
});

describe('remote signing keys', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
    server = undefined;
  });

  async function serveJwks(status: number, body: string): Promise<string> {
    server = createServer((request, response) => {
      if (request.url === '/auth/v1/.well-known/jwks.json') {
        response.writeHead(status, { 'content-type': 'application/json' }).end(body);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  function remoteVerifier(baseUrl: string): JoseAccessTokenVerifier {
    return new JoseAccessTokenVerifier({
      issuer: supabaseIssuer(baseUrl),
      audience: TEST_AUDIENCE,
      keys: createSupabaseJwks(baseUrl),
      clock: systemClock,
    });
  }

  it('derives the issuer and key-set URL from SUPABASE_URL', () => {
    expect(supabaseIssuer('https://abc.supabase.co')).toBe('https://abc.supabase.co/auth/v1');
    expect(supabaseIssuer('https://abc.supabase.co/')).toBe('https://abc.supabase.co/auth/v1');
  });

  it('verifies against the published key set', async () => {
    const baseUrl = await serveJwks(200, JSON.stringify({ keys: [issuer.publicJwk] }));
    const sub = randomUUID();
    const token = await issuer.issue({ sub, issuer: supabaseIssuer(baseUrl) });

    await expect(remoteVerifier(baseUrl).verify(token)).resolves.toMatchObject({
      authUserId: sub,
    });
  });

  it('reports an unreachable key set as unavailable, not as an invalid session', async () => {
    const baseUrl = await serveJwks(500, 'upstream failure');
    const token = await issuer.issue({ issuer: supabaseIssuer(baseUrl) });

    await expect(remoteVerifier(baseUrl).verify(token)).rejects.toBeInstanceOf(
      AccessTokenVerificationUnavailableError,
    );
  });

  it('reports a refused connection as unavailable', async () => {
    const baseUrl = 'http://127.0.0.1:9';
    const token = await issuer.issue({ issuer: supabaseIssuer(baseUrl) });

    await expect(remoteVerifier(baseUrl).verify(token)).rejects.toBeInstanceOf(
      AccessTokenVerificationUnavailableError,
    );
  });
});
