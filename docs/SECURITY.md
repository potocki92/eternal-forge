# Eternal Forge — Security Model

Status: PARTIALLY IMPLEMENTED (Phases 0–2) / EVOLVING

The principles below are binding from the first line of gameplay code. A
per-control implementation status is listed at the end of this document.

Eternal Forge is a competitive online game.

Assume the client is hostile.

---

# Primary principle

Never trust the client.

The browser can be:

modified,
automated,
reverse engineered,
replayed,
intercepted.

Frontend validation exists for UX.

Backend validation exists for security.

---

# Server authority

Server controls:

damage
combat results
rewards
XP
currency
drops
upgrades
crafting
prestige
PvP
leaderboards.

Client-provided results are never authoritative.

---

# Authentication

Supabase Auth is the initial authentication provider.

Backend must validate authenticated identity.

Never accept an arbitrary playerId as proof of identity.

Example:

BAD:

POST /upgrade

{
"playerId": "123",
"itemId": "abc"
}

and trust playerId.

Instead derive player identity from authenticated context.

---

# Authorization

Authentication answers:

Who are you?

Authorization answers:

Are you allowed to perform this operation?

Every player-owned resource must validate ownership.

Examples:

items
characters
guild operations
rewards
settings.

---

# Input validation

Validate all external input.

Use Zod/shared contracts where appropriate.

Backend must independently validate gameplay constraints.

---

# Economy

Economy operations must be atomic.

Important operations should be:

transactional
idempotent
auditable.

Examples:

purchase
upgrade
craft
prestige
claim reward.

---

# Idempotency

Network retries must not duplicate rewards.

Example:

ClaimOfflineReward request sent twice

must produce:

one reward.

Not:

two rewards.

---

# Race conditions

Assume a malicious or accidental client can send multiple requests
simultaneously.

Examples:

upgrade item 20 times
claim reward 10 times
equip/sell same item concurrently.

Use appropriate transactional/concurrency protection.

---

# Rate limiting

Apply rate limiting to sensitive/high-frequency endpoints.

Do not rely on UI cooldowns.

Exact limits should be based on endpoint semantics.

---

# Leaderboards

Leaderboard values must originate from server-verified state.

Never accept:

{
"stage": 999999
}

from the browser and insert it into ranking.

---

# Offline progress

Use server time.

Do not trust device clock.

Validate:

last processed state
maximum offline duration
progress rules.

---

# Deterministic combat

Deterministic simulation enables:

reproduction
validation
testing
potential replay verification.

Seeds must not allow clients to freely manipulate rewards.

---

# Secrets

Never commit:

.env
API secrets
service role keys
database credentials
private tokens.

Provide:

.env.example

with placeholder values.

---

# Supabase

Never expose privileged service credentials to the browser.

Public browser configuration and privileged server configuration must remain
separate.

Use database access controls/RLS where appropriate.

RLS is defense-in-depth, not an excuse to skip backend authorization.

Be precise about what RLS does and does not protect here. The application
reaches PostgreSQL through Prisma using a privileged role, which RLS does not
constrain. RLS therefore protects only paths where a browser talks to Supabase
directly — and in a server-authoritative design (ADR-003) there are no such
paths for gameplay data.

The intended posture is therefore:

- the browser never reads or writes gameplay data through Supabase directly;
- RLS denies the anon and authenticated roles by default, so a future direct
  path cannot accidentally expose a table;
- backend authorization remains the control that actually enforces ownership.

---

# Logging

Never log:

passwords
access tokens
refresh tokens
service keys
full sensitive authentication headers.

Use structured logs.

Use correlation/request IDs.

---

# Error handling

Do not expose:

stack traces
database credentials
internal SQL
secrets

to production clients.

Return safe application errors.

Log appropriate internal details server-side.

---

# Dependencies

Keep dependencies maintained.

Use automated dependency/security scanning where practical.

Do not automatically apply breaking dependency upgrades without validation.

---

# Anti-cheat philosophy

Do not attempt to hide game formulas as the primary defense.

Assume players can understand client code.

Security comes from:

server authority
validation
transactions
rate limits
deterministic rules
auditability.

---

# Security review

Every major economy or competitive feature should answer:

Can the client fake it?

Can it be replayed?

Can it be called concurrently?

Can rewards be duplicated?

Can another player's resource be targeted?

Can invalid numeric values enter the system?

Can the operation leave partial state?

If any answer is uncertain, the feature is not finished.

---

# Implementation status

## IMPLEMENTED (Phase 0)

- Environment validation at process start. Failures list variable _names_ and
  reasons; values never appear in an error message or a log line (ADR-010).
- Server/client configuration split enforced by the module graph. The privileged
  configuration module and the Supabase service-role client both refuse to load
  or be constructed in a browser runtime.
- Structured logging with redaction of authorization headers, cookies,
  passwords, access and refresh tokens and service keys.
- A global exception filter that returns a status code and a generic reason.
  Stack traces, driver messages and SQL never cross the boundary; the full error
  is logged server-side with a correlation ID.
- Correlation IDs on every request. An inbound `x-request-id` is accepted only
  when it matches a restricted character set and length, because the value is
  echoed into a response header and into logs.
- Helmet security headers and an explicit CORS allow-list.
- Readiness output reports a dependency as `unreachable` or `timed out` and
  never includes the driver's message, which can contain a connection string.
- `.env` is git-ignored; `.env.example` carries placeholders only.

## IMPLEMENTED (Phase 1) — in Game Core

These are properties of the pure engine. They start protecting players only
once a server endpoint calls the engine (Phase 2 onwards).

- Deterministic simulation. `simulateCombat` and `simulateStages` are pure
  functions of `(input, seed, rulesVersion)`, so any result the server stores
  can be recomputed and checked (ADR-005, ADR-015).
- Seeds are opaque strings the caller supplies. Game Core has no way to obtain
  one from a client; keeping seeds server-side is the caller's obligation
  (ADR-005).
- Invalid numbers are rejected, never repaired. Negative health, damage or
  rewards, non-integer rates, `NaN`, `Infinity`, unsafe integers, malformed
  or out-of-range HugeNumber strings, and unsupported rule versions all throw a
  typed `GameCoreError`. HugeNumber overflow is an error, never `Infinity`.
- Work is bounded. A seed is at most 256 characters and decimal input at most
  512 characters. The attack-speed cap and the time limit bound a combat, and
  a stage simulation handles at most 10 000 stages per call. A caller cannot
  make one call do unbounded work.

## IMPLEMENTED (Phase 2) — authentication and player identity

See ADR-016 and ADR-017.

- **Identity from verified tokens only.** The API verifies Supabase access
  tokens locally: signature, algorithm allow-list, issuer, audience, expiry,
  UUID subject, `role = authenticated`, not anonymous. No endpoint accepts a
  player, profile, character or auth-user id as proof of identity; the
  provisioning body is a strict schema that rejects extra fields.
- **Default deny.** A global guard protects every route; only the health
  endpoints are `@Public()`.
- **No algorithm confusion.** HS256 is refused unless a legacy secret is
  configured; `none` is never accepted. The public anon key and the
  service-role key are refused by the role check.
- **Least privilege.** No Phase 2 process holds the service-role key. The API
  needs only the project URL, from which it derives the issuer and the public
  key set. `SUPABASE_URL` must be `https` in production, because signing keys
  are fetched from it.
- **Service-role key never in the browser.** Server-only configuration schemas
  live in a module the client entry point cannot reach. CI builds the web
  application with a canary service-role key present and fails if the value, or
  the names of privileged variables, appear anywhere in the browser bundle.
- **Ownership in SQL.** The repository port has no by-id-only reads; character
  lookup filters on id *and* owner. Another player's character is
  indistinguishable from a missing one (404), so ids cannot be probed.
- **Row Level Security** enabled on `profiles` and `characters` with no
  policies (deny by default); `anon`/`authenticated` privileges revoked on
  Supabase. Verified by an integration test that queries as a non-owner role.
- **Input validation** with the shared Zod contracts at the controller; the
  domain re-validates names; PostgreSQL CHECK constraints re-validate lengths
  and ranges. Validation errors report field paths and rule messages, never the
  submitted value.
- **Transport of tokens.** `Authorization: Bearer` only — never query strings
  (logs, history) or cookies (CSRF). Oversized or malformed headers are
  rejected before verification.
- **Errors.** 401s carry an RFC 6750 challenge and a generic message. A key-set
  outage returns 503 `AUTH_UNAVAILABLE` instead of logging players out. Only
  messages the API writes for players (`ApiException`) reach the client; every
  other error — including framework errors such as a JSON parse failure, which
  would quote the request body — is reduced to the standard status phrase. The
  exception filter logs the request *path*, not the URL, so query strings never
  reach logs.
- **Logging.** Redaction now also covers `token`, `access_token` and
  `refresh_token` fields; the guard logs rejection reasons, never tokens.
- **Provisioning** is transactional and idempotent under concurrency (unique
  constraints + `ON CONFLICT DO NOTHING`), verified against PostgreSQL.
- **Client session hygiene.** The query cache is keyed by user id and cleared
  on every change of user and on sign-out, before the network call completes.

## Standing review answers — Phase 2

- Can the client fake it? Identity comes only from a signature-verified token.
- Can it be replayed? A captured token works until it expires (bounded by the
  access-token lifetime); provisioning replays are idempotent.
- Can it be called concurrently? Yes; provisioning converges on one player.
- Can rewards be duplicated? No rewards exist in Phase 2.
- Can another player's resource be targeted? No; ownership is part of the query.
- Can invalid numeric values enter? Level/stage are server-set and
  CHECK-constrained. A stage is an exact `bigint` end to end (ADR-018), so
  nothing is rounded on read or write. The wire format accepts only the
  canonical decimal string, and anything outside 1 … 2^63 − 1 is rejected
  rather than clamped.
- Can the operation leave partial state? Provisioning is one transaction; a
  profile without a character is repaired by the next call.

## Known limitations

- **Revocation lag:** after sign-out, the access token remains valid at the API
  until it expires. The refresh token is revoked immediately.
- **Tokens in `localStorage`:** an XSS flaw would expose them. A strict Content
  Security Policy is not yet configured.
- **No rate limiting** on API endpoints yet. Supabase Auth applies its own limits
  to sign-in and sign-up.

## PLANNED

- Rate limiting — per endpoint semantics, Redis-backed so it holds across API
  replicas. First candidates: provisioning and every future economy command.
- Content Security Policy and further browser hardening headers for `apps/web`.
- Economy transactionality, idempotency keys and audit trail — Phase 4 onwards.
- Account deletion covering profile, characters and all future player data.
- Automated dependency and secret scanning in CI — Phase 20 at the latest.

## Standing review questions

Every major economy or competitive feature answers these before it is
considered finished:

Can the client fake it? Can it be replayed? Can it be called concurrently? Can
rewards be duplicated? Can another player's resource be targeted? Can invalid
numeric values enter the system? Can the operation leave partial state?
