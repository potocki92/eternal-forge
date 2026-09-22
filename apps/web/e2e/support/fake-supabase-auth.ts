/**
 * Supabase Auth (GoTrue) test double — FOR TESTS AND LOCAL DEVELOPMENT ONLY.
 *
 * Implements the slice of the GoTrue HTTP API that `@supabase/supabase-js`
 * calls for email/password sessions, and signs access tokens exactly as a
 * Supabase project with asymmetric signing keys does: ES256, a published JWKS,
 * `iss = <url>/auth/v1`, `aud = authenticated`, `role = authenticated`.
 *
 * The browser therefore runs the real Supabase client and the API runs its real
 * token verifier; only the identity provider is substituted. This keeps the
 * end-to-end suite deterministic and independent of a hosted project (ADR-016).
 *
 * State is in memory and lost on exit. Passwords are hashed with scrypt even
 * here, so no code path in the repository stores a plaintext password.
 *
 *   pnpm --filter @eternal-forge/web run auth:stub
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

const PORT = Number(process.env['FAKE_AUTH_PORT'] ?? 54329);
const HOST = process.env['FAKE_AUTH_HOST'] ?? '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const ISSUER = `${BASE_URL}/auth/v1`;
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env['FAKE_AUTH_ACCESS_TOKEN_TTL'] ?? 3600);
const MIN_PASSWORD_LENGTH = 8;

interface User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: Buffer;
  readonly salt: Buffer;
  readonly createdAt: string;
}

interface RefreshSession {
  readonly userId: string;
  readonly sessionId: string;
}

const usersByEmail = new Map<string, User>();
const usersById = new Map<string, User>();
/** refresh token → session. Rotated on every refresh, as GoTrue does. */
const refreshTokens = new Map<string, RefreshSession>();

const { privateKey, publicKey } = await generateKeyPair('ES256');
const kid = randomUUID();
const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function userJson(user: User) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.createdAt,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: user.createdAt,
    updated_at: user.createdAt,
    is_anonymous: false,
  };
}

async function issueSession(user: User, sessionId: string = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({
    email: user.email,
    role: 'authenticated',
    aal: 'aal1',
    session_id: sessionId,
    is_anonymous: false,
  })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(privateKey);

  const refreshToken = randomBytes(24).toString('base64url');
  refreshTokens.set(refreshToken, { userId: user.id, sessionId });

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    expires_at: now + ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    user: userJson(user),
  };
}

function revokeWhere(predicate: (session: RefreshSession) => boolean): void {
  for (const [token, session] of refreshTokens) {
    if (predicate(session)) {
      refreshTokens.delete(token);
    }
  }
}

function sessionFromBearer(request: IncomingMessage): { userId: string; sessionId: string } | null {
  const token = /^Bearer (.+)$/u.exec(request.headers.authorization ?? '')?.[1];
  const payload = token?.split('.')[1];
  if (payload === undefined) {
    return null;
  }
  // Signature checking is the API's job; the double only needs the claims.
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: unknown;
    session_id?: unknown;
  };
  return typeof claims.sub === 'string' && typeof claims.session_id === 'string'
    ? { userId: claims.sub, sessionId: claims.session_id }
    : null;
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'x-supabase-api-version': '2024-01-01',
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function fail(response: ServerResponse, status: number, code: string, message: string): void {
  send(response, status, { code, error_code: code, msg: message });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', BASE_URL);
  const route = `${request.method ?? 'GET'} ${url.pathname}`;

  switch (route) {
    case 'GET /auth/v1/.well-known/jwks.json':
      send(response, 200, { keys: [publicJwk] });
      return;

    case 'GET /auth/v1/health':
    case 'GET /health':
      send(response, 200, { name: 'GoTrue test double', description: 'tests only' });
      return;

    case 'POST /auth/v1/signup': {
      const body = await readJson(request);
      const email = stringField(body, 'email').trim().toLowerCase();
      const password = stringField(body, 'password');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
        fail(
          response,
          400,
          'validation_failed',
          'Unable to validate email address: invalid format',
        );
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        send(response, 422, {
          code: 'weak_password',
          msg: `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`,
          weak_password: { reasons: ['length'] },
        });
        return;
      }
      if (usersByEmail.has(email)) {
        fail(response, 422, 'user_already_exists', 'User already registered');
        return;
      }
      const salt = randomBytes(16);
      const user: User = {
        id: randomUUID(),
        email,
        salt,
        passwordHash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      usersByEmail.set(email, user);
      usersById.set(user.id, user);
      // Behaves like a project with email auto-confirmation enabled.
      send(response, 200, await issueSession(user));
      return;
    }

    case 'POST /auth/v1/token': {
      const body = await readJson(request);
      const grantType = url.searchParams.get('grant_type');

      if (grantType === 'password') {
        const user = usersByEmail.get(stringField(body, 'email').trim().toLowerCase());
        const password = stringField(body, 'password');
        if (
          user === undefined ||
          !timingSafeEqual(hashPassword(password, user.salt), user.passwordHash)
        ) {
          fail(response, 400, 'invalid_credentials', 'Invalid login credentials');
          return;
        }
        send(response, 200, await issueSession(user));
        return;
      }

      if (grantType === 'refresh_token') {
        const token = stringField(body, 'refresh_token');
        const session = refreshTokens.get(token);
        const user = session && usersById.get(session.userId);
        if (session === undefined || user === undefined) {
          fail(
            response,
            400,
            'refresh_token_not_found',
            'Invalid Refresh Token: Refresh Token Not Found',
          );
          return;
        }
        refreshTokens.delete(token);
        send(response, 200, await issueSession(user, session.sessionId));
        return;
      }

      fail(response, 400, 'validation_failed', 'Unsupported grant type');
      return;
    }

    case 'POST /auth/v1/logout': {
      const caller = sessionFromBearer(request);
      if (caller === null) {
        fail(response, 401, 'no_authorization', 'This endpoint requires a valid Bearer token');
        return;
      }
      const scope = url.searchParams.get('scope') ?? 'global';
      if (scope === 'global') {
        revokeWhere((session) => session.userId === caller.userId);
      } else if (scope === 'local') {
        revokeWhere((session) => session.sessionId === caller.sessionId);
      } else {
        revokeWhere(
          (session) => session.userId === caller.userId && session.sessionId !== caller.sessionId,
        );
      }
      response.writeHead(204).end();
      return;
    }

    case 'GET /auth/v1/user': {
      const caller = sessionFromBearer(request);
      const user = caller && usersById.get(caller.userId);
      if (user == null) {
        fail(response, 401, 'bad_jwt', 'invalid JWT');
        return;
      }
      send(response, 200, userJson(user));
      return;
    }

    // Test control: revoke every session of a user, as an administrator or a
    // password change would. Not part of GoTrue.
    case 'POST /__test__/revoke-sessions': {
      const email = stringField(await readJson(request), 'email')
        .trim()
        .toLowerCase();
      const user = usersByEmail.get(email);
      if (user !== undefined) {
        revokeWhere((session) => session.userId === user.id);
      }
      response.writeHead(204).end();
      return;
    }

    default:
      fail(response, 404, 'not_found', 'Not found');
  }
}

const server = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader(
    'access-control-allow-headers',
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  );
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('access-control-expose-headers', 'x-supabase-api-version');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  handle(request, response).catch(() => {
    fail(response, 500, 'unexpected_failure', 'Unexpected failure');
  });
});

server.listen(PORT, HOST, () => {
  console.warn(`Supabase Auth TEST DOUBLE listening on ${BASE_URL} — never use in production.`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
