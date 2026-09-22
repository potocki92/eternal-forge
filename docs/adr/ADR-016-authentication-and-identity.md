# ADR-016 — Authentication, identity and session handling

## Status

Accepted

## Date

2026-09-22

## Context

Phase 2 makes the API load-bearing: players register, sign in and read their
own state. Several constraints meet here.

- Supabase Auth is the identity provider (ADR-004, `docs/ARCHITECTURE.md`). It
  owns credentials, password hashing, email confirmation and sessions. The
  project must not build a second password system.
- The server is authoritative (ADR-003). Identity must come from a verified
  credential, never from a `playerId` in a request.
- The API is a separate NestJS process on a different origin from the Next.js
  application (ADR-012). Its hosting is not decided yet.
- Supabase projects sign access tokens either with asymmetric keys (ES256/RS256,
  published as a JWKS) or, for older projects, with a shared HS256 secret. The
  public anon key of a legacy project is itself an HS256 JWT.
- Standard CI must stay deterministic and must not depend on a hosted Supabase
  project or credentials.

## Decision

### Who owns what

- **Supabase Auth** owns identity: sign-up, sign-in, password storage,
  sessions, refresh-token rotation, email confirmation.
- **Our database** owns the game profile, linked to the Supabase user by
  `profiles.auth_user_id` (ADR-017).
- **The browser** talks to Supabase Auth directly, through `@supabase/supabase-js`
  with the public anon key, for authentication only. It never reads or writes
  game data through Supabase; all game data flows through the API.

### Token verification in the API

- The API accepts a Supabase access token only in `Authorization: Bearer`.
  Never from a query string (it would land in logs and history) and never from
  a cookie (it would make every endpoint a CSRF target).
- Tokens are verified **locally** by `JoseAccessTokenVerifier` (library: `jose`):
  signature, an explicit algorithm allow-list, `iss = <SUPABASE_URL>/auth/v1`,
  `aud = authenticated`, `exp`/`iat` with 5 s clock tolerance, a UUID `sub`,
  `role = authenticated`, and `is_anonymous` not true.
- Signing keys come from the project's JWKS
  (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), fetched lazily and cached,
  refetched on an unknown `kid`. `SUPABASE_URL` must be `https` in production.
- HS256 is accepted **only** when `SUPABASE_JWT_SECRET` is configured. Without
  it, HS256 tokens are refused, ruling out algorithm confusion against the
  public keys. The anon and service-role keys are refused by the role check.
- The API needs **no privileged credential**. The service-role key is not part
  of its configuration.
- Verification sits behind the `AccessTokenVerifier` port. Tests use the
  production adapter with locally generated keys; nothing about verification is
  mocked.
- When the key set cannot be fetched, the API answers **503 `AUTH_UNAVAILABLE`**,
  not 401. A transient outage of the key endpoint must not sign every player out.

### Default-deny routing

`AuthGuard` is registered globally (`APP_GUARD`). Every route requires a verified
token unless it is explicitly marked `@Public()`; today only `/health` and
`/health/ready` are. Handlers receive the caller through `@CurrentIdentity()`,
which reads a value the guard stored in a `WeakMap` keyed by the request —
nothing the client sends can populate it. Failures follow RFC 6750
(`WWW-Authenticate: Bearer …`) and use the shared `ApiErrorResponse` contract.

### Browser session handling

- `supabase-js` persists the session in `localStorage` under
  `eternal-forge.auth`, refreshes the access token before expiry, and broadcasts
  sign-in/sign-out to other tabs of the same origin.
- `AuthProvider` mirrors only *who* is signed in. Player data lives in TanStack
  Query under keys that include the user id, and the **entire query cache is
  cleared** whenever the signed-in user changes or signs out — including when the
  change comes from another tab or a failed refresh. On a player-initiated
  sign-out, state is cleared *before* the network round trip.
- An authenticated request that gets 401 refreshes the token once and retries.
  If the session cannot be refreshed or the retry is also refused, the session is
  ended locally and the player is sent to sign-in with an explanation.
- `RequireAuth` and `GuestOnly` are navigation, not security. The protected
  pages hold no data of their own; everything comes from the API.
- There is no server-side rendering of authenticated data, so no auth cookie and
  no Next.js middleware are needed.

### Testing without Supabase

`apps/web/e2e/support/fake-supabase-auth.ts` is a GoTrue test double: it
implements the endpoints `supabase-js` calls for email/password sessions and
issues ES256 tokens with a JWKS, exactly like a Supabase project with asymmetric
keys. The browser runs the real Supabase client and the API runs its real
verifier. The same double serves local development without a Supabase project
(`pnpm --filter @eternal-forge/web run auth:stub`). It is never deployed.

## Consequences

- No network round trip per request for authentication; the API scales without
  talking to Supabase on the hot path.
- **Revocation lag.** A revoked session's access token stays valid at the API
  until it expires (Supabase default: one hour). Sign-out revokes the refresh
  token immediately, so the window is bounded by the access-token lifetime.
  Operations that need immediate revocation later (e.g. account deletion,
  purchases) can add a session check against Supabase for those endpoints only.
- **Tokens in `localStorage`** are readable by any script on the origin, so an
  XSS vulnerability would expose them. Cookie-based storage readable by
  JavaScript (as `@supabase/ssr` uses) has the same exposure; an HttpOnly-cookie
  design would require a same-origin backend-for-frontend. Mitigation is
  preventing XSS: React escaping, no `dangerouslySetInnerHTML`, and a strict
  Content Security Policy (tracked as technical debt).
- The identity provider can be swapped by replacing one adapter
  (`AccessTokenVerifier`) and the browser client; game data never references the
  Supabase user id outside `profiles.auth_user_id`.
- Anonymous sign-in is refused until the product decides to support it.

## Alternatives Considered

**Call `supabase.auth.getUser(token)` on every request.** Detects revocation
immediately but adds a network round trip and a hard dependency on Supabase to
every request. Rejected as the default; kept available for specific endpoints.

**Only the legacy HS256 secret.** Simpler, but the API would hold a secret that
can mint tokens, and Supabase is moving projects to asymmetric keys. Supported
for compatibility, not preferred.

**`@supabase/ssr` with cookies and Next.js middleware.** Enables server-side
redirects and SSR of authenticated pages. The API is a separate origin that
needs a bearer token anyway, nothing is server-rendered with player data, and
cookies would add CSRF surface to the API. Rejected for now; revisit if the web
application starts rendering authenticated data on the server.

**Running a local Supabase stack in CI.** Realistic, but heavy and slow to start,
and the requirement is that Supabase does not destabilise standard CI. The GoTrue
test double exercises the same client and verifier code paths.

**Mocking the verifier in API tests.** Would test the guard but not the rules
that actually protect players. Rejected in favour of real keys.
