# Eternal Forge — Security Model

Status: PARTIALLY IMPLEMENTED (Phases 0–3, Phase 4 PRs 4.1–4.3) / EVOLVING

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

## IMPLEMENTED (Phase 3) — the combat transaction

See ADR-019.

- **No gameplay input from the client.** `POST
  /player/characters/:characterId/combats` has no body. Anything sent in one
  is ignored, and a test sends a forged stage, level, seed, outcome and reward
  to prove it. The character id is a *target*, resolved with the verified
  owner in the `WHERE` clause. Another player's character is a 404.
- **Seeds are server custody.** Every combat draws 256 bits from the OS
  CSPRNG. The seed does not exist before the request and is never sent to
  the client. The result is committed before the response leaves, so a client
  cannot discard an unfavourable roll and try again.
- **Game Core decides everything.** Enemy, damage, outcome, rewards,
  experience, level-up, and stage advance or fallback all come from one pure
  function (`resolveStageAttempt`). The API adds no rule, and a test compares
  the API's result with Game Core's for the same seed.
- **Replay-safe.** An idempotency key (a UUID, validated, never echoed) is
  unique per character in `combat_runs`. A repeated key returns the recorded
  combat, re-simulated from its stored inputs and checked against its stored
  summary. It is never a second reward. A mismatch is a logged 500, never a
  different result.
- **Concurrency-safe.** An optimistic version check in the same transaction
  as the combat insert means concurrent requests produce one combat. This is
  verified with 25 simultaneous requests, and with retries spread across two
  API instances, against PostgreSQL.
- **Pacing gate.** A combat occupies the hero for its simulated duration on
  the server clock. An earlier request is `409 COMBAT_NOT_READY` with
  `Retry-After`. A script therefore cannot progress faster than the rules
  allow, which a request rate limit alone would not prevent.
- **Ledger integrity in the database.** The HugeNumber CHECKs reject
  negative, fractional and non-normalised amounts. A combat row whose outcome
  and end reason disagree, or a loss that pays, cannot be stored. RLS is
  enabled on `combat_runs`, with `anon` and `authenticated` revoked.
- **Browser boundary.** `apps/web` may import only the `HugeNumber` value
  type from Game Core (ESLint). The web build refuses privileged
  `NEXT_PUBLIC_` variables. Responses are validated against the shared
  contract before rendering.
- **Stage records are server truth (ADR-020).** The current stage, the highest
  stage reached and the highest stage cleared are all written only by Game
  Core's transition, inside the same version-conditional transaction. A
  record can rise only through a committed win and never falls. No request
  field can set them. Game Core, the CHECK constraints and the contract each
  enforce the invariants. A future ranking reads `highest_stage_cleared`,
  which only a recorded win can raise. A stage too deep for the rule set is
  refused with `409 STAGE_NOT_PLAYABLE` before a seed is drawn, and nothing is
  written.

## Standing review answers — Phase 3 (combat)

- Can the client fake it? No. The request carries no gameplay value, and the
  server derives stage, enemy, seed and result from persisted state.
- Can it be replayed? A replayed key returns the same recorded combat. A new
  key before `nextCombatAt` is refused. After it, it is simply the next
  legitimate fight.
- Can it be called concurrently? Yes. Exactly one request commits, the others
  replay or receive 409. Verified against PostgreSQL.
- Can rewards be duplicated? No. One row per `(character, key)`, one version
  step per combat, and no reward on a loss, even at the database level.
- Can another player's resource be targeted? No. Ownership is in the read and
  again in the conditional update.
- Can invalid numeric values enter? No. Stages are exact `bigint`s (ADR-018),
  and the three stage values must satisfy their invariants at every layer
  (ADR-020). Nothing is clamped or truncated.
  Amounts are canonical HugeNumbers, whole and non-negative by contract and
  by CHECK. Level is bounded by Game Core and the column.
- Can the operation leave partial state? No. The progress update and the
  combat row commit in one transaction or not at all.

## IMPLEMENTED (Phase 4 PR 4.1) — stage selection

See ADR-021.

- **The client states an intent, the server decides.** The body is
  `{ mode: "PROGRESS" }` or `{ mode: "FARM", stage }`, validated by a strict
  shared schema: any extra field (a record, a reward, an owner) is a 400, and
  the stage must be a canonical decimal string of 1 … 2^63 − 1. Game Core's
  `selectStage` then checks the stage against the character's own
  `highestStageReached`; beyond it is `409 STAGE_LOCKED`, never clamped. The
  database CHECK `current_stage ≤ highest_stage_reached` backs it.
- **No record can be written by a selection.** The repository writes only
  `current_stage`, `stage_mode` and `version`. Records rise only through a
  committed win, in either mode.
- **Ownership** is in the read and in the conditional write; another player's
  character is a 404.
- **Combat reads the mode from the database**, never from the request, and
  records it on `combat_runs` for replay.
- **Error bodies never echo the submitted value.** An oversized body is now a
  `413` with the standard phrase; it used to be a logged `500`.

## Standing review answers — Phase 4 PR 4.1 (stage selection)

- Can the client fake it? It can ask for any stage; only a reached stage is
  accepted, and the choice grants nothing by itself.
- Can it be replayed? Repeating a selection sets the same value; no key is
  needed.
- Can it be called concurrently? Yes. Selection and combat share the version
  check; the loser writes nothing. Verified against PostgreSQL across two API
  instances.
- Can rewards be duplicated? No: a selection grants none, and combat
  idempotency is unchanged.
- Can another player's resource be targeted? No: 404, and the write is
  owner-scoped.
- Can invalid numeric values enter? No: canonical strings, exact `bigint`
  comparison (`2^53 + 4` is not accepted against a frontier of `2^53 + 3`).
- Can the operation leave partial state? No: one single-row `UPDATE`.

## IMPLEMENTED (Phase 4 PR 4.2) — online auto-battle

See ADR-022. Online auto-battle is not offline progression: it exists only
while a client sends requests.

- **No new attack surface.** No endpoint, field, header or contract was
  added. Each auto fight is the ordinary combat request with no body; the
  server cannot distinguish the loop from a tap, so the loop has no privilege
  a script does not already have — and none is needed.
- **The server paces it.** The loop sends the next fight at the server's
  `nextCombatAt`, read relative to `serverTime`. A changed device clock,
  a throttled tab, a script firing every 250 ms or several tabs only change
  when requests arrive; early ones are `409 COMBAT_NOT_READY` and write
  nothing. Integration tests prove combats never overlap under a greedy
  client and across two API instances.
- **No catch-up.** Nothing in the browser or on the server credits time the
  loop did not fight. A hidden page starts no fight; a late timer sends one
  request.
- **Bounded retries.** Same-key retries with backoff (2–30 s) for transient
  errors and 429; a re-read before retrying after `COMBAT_NOT_READY`; a halt
  after 5 (or 10 "busy") consecutive failures and on any 401, 403, 404 or
  `STAGE_NOT_PLAYABLE`. The loop cannot become a request storm against a
  failing API.
- **Observability.** Structured events `combat.replayed`, `combat.conflict`,
  `combat.stage_not_playable` and `combat.not_ready` (debug level, since a
  spammer produces one per request) carry the character and combat ids and
  never a token, seed or body.

## Standing review answers — Phase 4 PR 4.2 (online auto-battle)

- Can the client fake it? No. The loop sends no gameplay value; every fight
  is decided by the server from persisted state.
- Can it be replayed? A retried key replays the recorded combat (200); the
  loop reuses a key only for retries of the same intent.
- Can it be called concurrently? Yes, from any number of tabs and devices;
  one combat commits per gate window, the others get `409`. Verified against
  PostgreSQL across two API instances and in the browser with two tabs.
- Can rewards be duplicated? No: combat idempotency and the version check are
  unchanged.
- Can another player's resource be targeted? No: 404, as for any combat.
- Can invalid numeric values enter? No: nothing new is accepted. Stages stay
  exact strings; stage 2^53 + 1 is served exactly and refused as
  `STAGE_NOT_PLAYABLE` under rules v1.
- Can the operation leave partial state? No: Stop never aborts a request;
  each combat commits whole or not at all.

## IMPLEMENTED (Phase 4 PR 4.3) — offline progression

See ADR-023.

- **No client time.** `POST /player/characters/:characterId/offline-progress`
  has no body (anything sent is ignored — a test sends a forged elapsed time,
  client clock, stage and reward). Idle time is the API clock minus the
  persisted boundary `next_combat_at`, never negative.
- **Capped and bounded.** At most 8 hours count; at most 30 000 fights are
  simulated per claim (`LIMIT_EXCEEDED` beyond, never unbounded CPU). Under
  rules v1 an 8-hour claim is ≤ 28 800 fights, ~0.35 s.
- **One time line.** Online combat and offline claims move the same boundary
  in the same version-conditional write; no interval can be paid twice.
- **Seeds are server custody and cannot be re-rolled.** The claim seed is
  stored on the character (`offline_seed`), fixed until a claim commits and
  then replaced from the CSPRNG. A claim that fits nothing writes nothing but
  also cannot draw a new seed.
- **Replays are cheap.** A repeated key is answered from the stored summary,
  never re-simulated.
- **No barrier breaking.** Offline fights only on a stage ≤ the highest
  cleared (Game Core rule and a database CHECK) and never writes a stage
  column, so rankings cannot be raised offline.
- **Observability.** `offline.processed`, `offline.capped`,
  `offline.replayed`, `offline.noop` (debug), `offline.conflict`,
  `offline.rejected`, with character and claim ids, counts and durations —
  never a token, seed or body.

## Standing review answers — Phase 4 PR 4.3 (offline progression)

| Threat                                   | Why it cannot duplicate or accelerate rewards                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A. fake elapsed time in the request      | No body is read; elapsed is server clock − persisted boundary                                         |
| B/C. device clock or timezone changed    | Never read; the web client sends no time                                                              |
| D. same claim replayed                   | Unique `(character, key)`; replay from the stored row, 200, nothing written                          |
| E. many different keys                   | After the first commit the boundary is ~now: the rest find nothing (tested: 100 keys, one claim)     |
| F. two devices at once                   | Shared version: one commits, the other re-reads and finds nothing (tested across two instances)      |
| G. refresh after commit, before response | Same key → replay; new key → nothing left to collect                                                  |
| H. API spam                              | Each no-op is one read + a cheap check; general rate limiting still PLANNED (see Known limitations)   |
| I/J. forged or foreign character id      | UUID-validated path; owner in read and write → 404, nothing written                                  |
| K. stage selection during a claim        | Version conflict → the claim re-resolves against the new state; records never written                |
| L/M. combat or auto-battle during claim  | Both move the same boundary under the version: whichever commits first owns the time                 |
| N. huge body                             | Ignored; the body parser limit answers 413 as before                                                  |
| O. future boundary or clock anomaly      | Elapsed clamps to 0; a backwards clock gives nothing; a forward jump is capped at 8 h                 |

- Can the operation leave partial state? No: rewards, boundary, seed and
  record commit in one transaction (tested by forcing the INSERT to fail).
- Can invalid numeric values enter? No: stages stay exact (2^53 + 1 tested),
  amounts are canonical HugeNumbers, CHECKs as on `combat_runs`.

## Known limitations

- **Revocation lag:** after sign-out, the access token remains valid at the API
  until it expires. The refresh token is revoked immediately.
- **Tokens in `localStorage`:** an XSS flaw would expose them. A strict Content
  Security Policy is not yet configured.
- **No general rate limiting** on API endpoints yet. Combat is bounded per
  character by the pacing gate, and even refused requests cost an owner-scoped
  read. Legitimate online auto-battle sends at most one combat request per
  combat duration plus about 1.2 s (≈ 0.5 requests/s per character under
  rules v1, where a combat lasts 1–30 s), plus bounded retries; a limit must
  allow that cadence per character and several tabs (ADR-022). Supabase Auth applies its own limits to sign-in and sign-up.
- **Offline claim CPU.** A claim that finds time to collect simulates up to
  ~0.35 s of CPU (8 hours, rules v1). Concurrent first claims for one
  character with different keys each simulate before the first commits; only
  one pays. Rate limiting (PLANNED) must bound this amplification.
- **Offline zero-result probe.** A claim that fits nothing reveals that the
  next offline fight is longer than the idle time. Switching farm stages
  between such probes lets a script prefer, for its next claim, a stage
  whose first fight is short. The seed cannot be re-rolled, the effect is
  limited to one fight per claim, and each probe costs a selection write.

## PLANNED

- Rate limiting — per endpoint semantics, Redis-backed so it holds across API
  replicas. First candidates: provisioning and every future economy command.
- Content Security Policy and further browser hardening headers for `apps/web`.
- The generic idempotency table for operations without a natural result row,
  and an `economy_transactions` ledger once gold can be *spent* — Phase 4
  onwards. Phase 3's credits are audited by `combat_runs`.
- Account deletion covering profile, characters and all future player data.
- Automated dependency and secret scanning in CI — Phase 20 at the latest.

## Standing review questions

Every major economy or competitive feature answers these before it is
considered finished:

Can the client fake it? Can it be replayed? Can it be called concurrently? Can
rewards be duplicated? Can another player's resource be targeted? Can invalid
numeric values enter the system? Can the operation leave partial state?

## Inventory/equipment authority — COMPLETE / APPROVED (Phase 5 PR 5.2)

The browser can read owned state and request equip by opaque item ID or unequip by canonical slot. It cannot submit ownership, definition, rarity, or equip slot and has no item-creation endpoint. Reads and writes are scoped by verified `auth_user_id`; foreign and absent resources share `NOT_FOUND`. Composite foreign keys enforce same-character equipment. RLS is enabled with no browser policies and `anon`/`authenticated` table privileges are revoked; only the privileged API accesses these tables.

## Combat item reward authority — IN PROGRESS (Phase 5 PR 5.3)

The client submits no definition, rarity, item ID, chance or seed. Authenticated online combat derives loot under rules v2 and persists it in the combat transaction. A unique reward FK and combat idempotency identity make retries and concurrent replicas converge on one persistent item. Failed, stale, unauthorized and losing commands create none. Existing item RLS and revoked browser privileges apply; no public item-mint route exists. Offline drops are explicitly disabled rather than implemented through an unbounded per-fight insert loop.

## Item affix authority — IN PROGRESS (Phase 6 PR 6.2)

The browser cannot submit rarity, affix identity/value, seed, generation version or item power. Affixes are generated in Game Core from a server-held combat seed and persisted with the reward in one transaction. PostgreSQL uniqueness prevents duplicate definitions/positions, RLS is enabled, browser table privileges are revoked, and no mint/reroll endpoint exists. Retries read the single persisted snapshot rather than generating again. Legacy items are deterministically version 0 with no rolls.
