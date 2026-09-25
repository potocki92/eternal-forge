# Eternal Forge — Development Roadmap

Last updated: 2026-09-24

# Current Phase

PHASE 6 — ITEM POWER & CHARACTER STATS

Status:

IN PROGRESS — Phase 5 is COMPLETE. PR 6.1 "Character Stats & Modifier
Foundation" is IN PROGRESS (ADR-027); PRs 6.2–6.4 are NOT STARTED.

Phase 4 is COMPLETE / APPROVED. PRs 4.1–4.4 are merged and the return
experience was manually verified. Phase 5 is complete through merged PR 5.4;
Phase 6 is now the current phase.

Phase 3 was merged to `main` as PR #6 (followed by the Supabase deployment
PRs #7 and #8). The user started Phase 4 on 2026-09-23 with the PR 4.1 task.

Phase 2 is COMPLETE / APPROVED: the post-audit hardening (ADR-018) was merged
as PR #5, and GitHub Actions is green on `main` (run #13 on `fb3db8b`, the merge
of PR #5). The user approved Phase 2 and asked for Phase 3 on 2026-09-23.

Phase 1 is COMPLETE / APPROVED: GitHub Actions is green on `main` (run #6 on
`a09b2a3`, the merge of PR #3) and the user approved completion on 2026-09-22.

Phase 0 is COMPLETE: GitHub Actions is green on `main` and the user approved
completion on 2026-09-22. One owner-only task (the Vercel deployment) is carried
forward and does not block later phases.

Claude must NOT begin another phase without explicit user approval.

---

# Phase 0 — Foundation

Status: COMPLETE — approved by the user on 2026-09-22 (one owner-only task carried forward)

Goal:

Create a production-quality project foundation.

Tasks:

- [x] initialize pnpm workspace — with a `catalog:` for shared dependency versions
- [x] configure Turborepo
- [x] create apps/web — Next.js 16, App Router, Tailwind v4
- [x] create apps/api — NestJS 12, layered health module
- [x] create apps/worker — BullMQ worker
- [x] create packages/game-core — boundary and guard rails only, no gameplay
- [x] create packages/contracts — health transport contracts
- [x] create packages/database — Prisma 7 + `pg` adapter, Supabase clients
- [x] create packages/ui — design tokens, Button, Panel, StatusBadge
- [x] create shared configuration — packages/typescript-config, packages/eslint-config
- [x] configure strict TypeScript
- [x] configure ESLint — including Game Core purity rules
- [x] configure formatting — Prettier, checked in CI
- [x] configure environment validation — packages/config, server/client split
- [x] prepare PostgreSQL integration — Prisma schema (no models), client factory, readiness probe
- [x] prepare Redis integration — per-process connections, readiness probe, BullMQ transport
- [x] prepare Supabase integration — privileged and public client factories, credential schemas
- [x] add API health endpoint — `/health` (liveness) and `/health/ready` (readiness, 503 on failure)
- [x] add web health/start page — `/`, `/status`, and `/api/health`
- [x] add worker smoke mechanism — `pnpm --filter @eternal-forge/worker run smoke`
- [x] configure Vitest — every package; SWC transform in apps/api for decorator metadata
- [x] configure Playwright skeleton — mobile (390x844) and desktop projects
- [x] configure GitHub Actions — quality, end-to-end and backing-services smoke jobs
- [x] create ADRs — ADR-001 … ADR-013
- [x] validate lint
- [x] validate typecheck
- [x] validate tests
- [x] validate build
- [x] fix CI on a clean checkout — Prisma generation is a Turborepo task (ADR-014)
- [x] re-validate locally, including on a fresh clone with no generated client
- [x] GitHub Actions green on `main` — run #4 on `7d6306b` (merge of PR #2):
      quality, end-to-end and backing-services smoke all passed
- [ ] deploy initial web application to Vercel — CARRIED FORWARD, owner action

CI re-validation (2026-09-22):

The first CI run on `main` failed in the Lint step. Type-aware ESLint reported
`new PrismaClient(...)` in `packages/database` as an unsafe construction of an
unresolved type. The cause was the task graph, not the code. `lint` did not
depend on `prisma generate`, and on a clean checkout the generated client did
not exist yet. `test` had the same gap, hidden by step order. Fixed by making
generation an explicit task that `build`, `typecheck`, `lint`, `test` and `dev`
depend on (ADR-014). No lint rule was disabled and no generated code was
committed.

Verified locally on a fresh clone after `git clean -fdx`: each of `lint`,
`typecheck`, `test` and `build` succeeds as the first command, and so do all
four together. Also passing: format check, 87 unit and integration tests, 8
Playwright tests (mobile and desktop), production build, and the
PostgreSQL/Redis smoke test (readiness 200 with both up, 503 with Redis down;
worker job round trip).

The self-review removed unused workspace dependencies: `game-core` and `zod`
from `apps/api`; `game-core`, `database` and `contracts` from `apps/worker`.

Green CI on GitHub (2026-09-22):

CI run #4 on `main` (commit `7d6306b`, the merge of PR #2) passed every job:
format check, lint, typecheck, unit tests and build; the Playwright suite; and
the PostgreSQL/Redis backing-services smoke. The user then approved Phase 0 as
complete.

Carried forward:

**Deploy initial web application to Vercel.** Requires Vercel account access,
which the development environment does not have. Everything needed is in the
repository: `apps/web/vercel.json`, and the project settings are documented in
ADR-012. The step is a dashboard action — import the repository, set the root
directory to `apps/web` — not a code change. It is the account owner's task and,
by the user's decision of 2026-09-22, does not block Game Core work.

---

# Phase 1 — Game Core Foundation

Status: COMPLETE / APPROVED — approved by the user on 2026-09-22 after GitHub
Actions passed on the pull request (run #5) and on `main` (run #6, `a09b2a3`)

Goal:

Create the first deterministic headless game simulation.

Entry requirement: ADR-013 (large-number representation, persistence format and
leaderboard ordering key) — MET. Accepted by the user on 2026-09-22 with all six
open questions answered.

Tasks:

- [x] HugeNumber — 18-digit decimal `bigint` coefficient, signed 32-bit
      exponent, half-to-even rounding, overflow error, underflow to zero (ADR-013)
- [x] canonical serialization — strict `parse`/`toString`, `toJSON`,
      `toParts`/`fromParts` for the two persistence columns
- [x] deterministic RNG — xoshiro128\*\* with string seeds and `deriveSeed` (ADR-015)
- [x] GAME_RULES_VERSION — bumped 0 → 1; versioned, frozen rule sets with a
      registry (ADR-015)
- [x] Character — stats derived from level by rule data
- [x] Enemy — archetype data scaled to a stage
- [x] Stats — shared `CombatStats`, validation, rule caps
- [x] Damage — normal and critical hits
- [x] Attack Speed — exact rational attack timeline, no floating point
- [x] Critical Chance — one RNG draw per attack
- [x] Critical Damage
- [x] CombatResult — outcome, end reason, duration, per-side summary, event log
- [x] Stage — unbounded stage numbers, boss every 10th stage
- [x] Stage Scaling — one centralised module
- [x] basic Rewards — gold and experience for a win, boss multiplier
- [x] simulateCombat — `simulateCombat({ player, enemy, seed, rulesVersion })`
- [x] simulateStages — headless ladder, stops at the first loss
- [x] CLI demonstration — `pnpm --filter @eternal-forge/game-core run simulate`
- [x] benchmark — `pnpm --filter @eternal-forge/game-core run bench`, outside
      `test` and CI
- [x] purity guard extended — engine-approximated `Math` functions banned by
      ESLint and by the source-scanning guard test
- [x] documentation — ADR-013 accepted, ADR-015 added, ARCHITECTURE,
      GAME_DESIGN, SECURITY, DATABASE, UI_SYSTEM, README updated

Target — MET:

```
$ pnpm --filter @eternal-forge/game-core run simulate -- --level 1 --seed demo
Stage    1      — WIN  (husk,   4.00 s, +5e0 gold, +3e0 xp)
Stage    2      — WIN  (husk,   4.00 s, +5e0 gold, +3e0 xp)
...
Stage    9      — WIN  (husk,  10.00 s, +1.2e1 gold, +6e0 xp)
Stage   10 boss — LOSS (PLAYER_DEFEATED, warden,  11.43 s)
```

The same transcript is asserted by `test/simulation.golden.test.ts`.

Validation (2026-09-22, local):

- format check, lint, typecheck, production build: pass (whole workspace).
- Unit and integration tests: 421 pass across the workspace, 338 of them in
  `packages/game-core`:
  - 146 HugeNumber golden vectors. The expected values were produced by
    Python's `decimal` module (18 digits, `ROUND_HALF_EVEN`), an oracle
    independent of the implementation.
  - 17 fast-check properties. They check `add`, `sub`, `mul` and `div` against
    an independent string-rounding reference, plus round-trips, ordering
    (including SQL `(exp, coef)` order) and algebraic identities. They run
    2 000 cases each in CI and passed a one-off run of 100 000 cases each.
  - xoshiro128\*\* matches the published reference output. Seed hashing matches
    an independent Python implementation.
  - Combat timelines verified by hand, and reproducibility: same input and seed
    give an identical result, checked with `toEqual` and byte-identical JSON.
  - Golden SHA-256 fingerprints of whole combat and stage-run results. The
    compiled package under plain Node reproduces the same fingerprints.
- Playwright end-to-end: pass (mobile and desktop).
- Game Core purity: no runtime dependencies. No imports outside the package, no
  `Math.random`, `Date.now`, approximated `Math` functions, `process.env` or
  globals. ESLint and the guard test both enforce this.

Benchmark (2026-09-22, development container, Node 22, `vitest bench`):

| Operation                                     | Throughput     |
| --------------------------------------------- | -------------- |
| `add`, small integers (exact)                 | ~6.4 M ops/s   |
| `add`, 18 digits, rounding                    | ~3.3 M ops/s   |
| `add`, exponent 10^6, rounding                | ~2.4 M ops/s   |
| `mul`, 18 × 18 digits, rounding               | ~2.8 M ops/s   |
| `compare`, different exponents               | ~11.6 M ops/s  |
| `compare`, equal exponents                    | ~7.9 M ops/s   |
| `div`                                         | ~3.6 M ops/s   |
| `pow(1.12, 100 000)` (stage scaling)          | ~157 k ops/s   |
| `simulateCombat`, regular stage               | ~200 k/s       |
| `simulateCombat`, boss to time limit/defeat   | ~84 k/s        |
| `simulateStages`, 100 stages                  | ~1.9 ms / run  |

Absolute numbers depend on the machine. No optimisation was attempted:
correctness and determinism came first, and nothing in Phase 1 is
throughput-bound.

Not in this phase, by design: authentication, player persistence, applying
rewards to an account, level-up from experience, items, skills, offline
progress, prestige, rankings, PvP and any combat UI. Deferred from ADR-013: the
Zod wire schema, the PostgreSQL columns and their `ORDER BY` test, and the
Redis score projection.

Approved by the user on 2026-09-22; Phase 2 started on the same date.

---

# Phase 2 — Authentication & Player

Status: COMPLETE / APPROVED — approved by the user on 2026-09-23, after GitHub
Actions passed on PR #4, on PR #5 (hardening) and on `main` (run #13, `fb3db8b`).

Goal:

Authentication → Profile → Character → persistent player state → a secure,
authenticated API, built as the foundation later phases attach to.

Decisions: ADR-016 (authentication, identity and sessions), ADR-017 (player
identity persistence and provisioning). ADR-010 amended.

Tasks:

- [x] Supabase Auth — browser `supabase-js` client with the public anon key;
      session persisted, auto-refreshed, synchronised across tabs
- [x] registration — email/password; handles projects with email confirmation
- [x] login
- [x] logout — clears client state before the network call; revokes the session
- [x] session handling — reload, new tab, expiry, refresh failure, invalid
      token, loading state
- [x] protected routes — `/play` requires a session; `/login`, `/register` are
      guest-only (navigation, not security)
- [x] authenticated backend — local JWT verification (JWKS, optional legacy
      HS256), global default-deny guard, RFC 6750 errors, 503 on key outage
- [x] profile — `profiles` table, own UUID, unique `auth_user_id`
- [x] character — `characters` table, slot model, source state only
      (`level`, `stage`)
- [x] persistence — Prisma models, first migration with CHECK constraints and
      Row Level Security (deny by default)
- [x] provisioning — `POST /player`, transactional and idempotent under
      concurrency
- [x] GET /player/state — shared contract in `packages/contracts`
- [x] GET /player/characters/:characterId — ownership-scoped read
- [x] shared error contract — `ApiErrorResponse` with machine-readable codes
- [x] frontend — sign-in, registration, "Name your hero" onboarding, player shell
      with display name, hero, level, stage and sign-out; mobile-first
- [x] UI primitives — `TextField`, `Alert`, `Skeleton` in `packages/ui`
- [x] tests — unit, application, API (HTTP), repository integration against
      PostgreSQL, authorization, provisioning concurrency, Playwright E2E
- [x] Supabase test double — GoTrue-compatible, real ES256 tokens; no hosted
      Supabase in CI
- [x] CI — PostgreSQL for E2E, migrations applied, integration tests, schema
      drift check, service-role canary check on the browser bundle
- [x] documentation — ADR-016, ADR-017, ADR-010 amendment, ARCHITECTURE,
      DATABASE, SECURITY, UI_SYSTEM, README
- [x] GitHub Actions green on the pull request — PR #4, run 35783641779 on
      `1d564ff`: quality (format, lint, typecheck, unit tests, build),
      PostgreSQL integration and smoke, Playwright end-to-end. The separate
      GitGuardian app check reports two synthetic, unsigned JWT test fixtures in
      earlier commits of the branch; they are not credentials, no longer exist in
      the tree, and the incident needs dismissal by the owner
- [x] review — Codex finding (name fields' native `maxLength` disagreed with the
      shared code-point rule) fixed in `1d564ff` with regression tests
- [x] post-audit hardening — see "Phase 2 hardening" below
- [x] user approval — 2026-09-23

Validation (2026-09-22, local, development container with PostgreSQL 16 and
Redis 7):

- format check, lint, typecheck, production build: pass (whole workspace).
- Unit and application tests: 536 pass across the workspace (Phase 1: 421).
  New or changed: `api` 82 (token verifier with real ES256/HS256 keys and a
  real HTTP key-set server; guard and HTTP authorization with an in-memory
  repository; use cases), `contracts` 33, `config` 33, `web` 27, `ui` 14.
  `game-core` 338, unchanged.
- PostgreSQL integration (`pnpm run test:integration`): 22 pass — provisioning,
  25 concurrent provisioning calls converging on one profile and one character,
  12 concurrent HTTP requests (one 201, eleven 200), ownership, every CHECK and
  unique constraint, bigint stages, cascade delete, Row Level Security denying a
  non-owner role. Ran five times in a row without a failure.
- Playwright E2E: 34 pass (17 scenarios × mobile 390x844 and desktop) against
  the production web build, the real API and PostgreSQL: protected route,
  registration with onboarding, validation, duplicate email, wrong password,
  reload, new tab, guest-only redirect, sign-out, account switch without stale
  data, cross-tab sign-out, expired session, API-rejected token.
- Migrations applied to an empty database and checked against the Prisma schema
  (`prisma migrate diff --exit-code`): no drift.
- Browser bundle built with a canary service-role key present: neither the
  value nor the names of privileged variables appear in `.next/static`.
- Game Core purity: unchanged and passing.
- Self-review found and fixed two defects before commit: the 503
  `AUTH_UNAVAILABLE` response lost its player-facing message in the exception
  filter, and framework parse errors quoted part of the request body back to the
  client. Both have regression tests.

Not in this phase, by design: combat UI, gameplay persistence (experience,
gold, stage progression), level-up, rate limiting, password reset and email
change screens, account deletion, display-name uniqueness. The API hosting
decision (ADR-012) remains open and needs the owner.

## Phase 2 hardening (post-audit, 2026-09-23)

Scope: the items raised by the external audit. No new tables, no Phase 3
gameplay, and the accepted request flow is unchanged.

- [x] StageNumber — a Game Core Value Object backed by an exact `bigint`,
      1 … 2^63 − 1. It replaces `stage: number` in Game Core, the API domain,
      the repository port and adapter, and the contract. `toSafeInteger()` is
      gone (ADR-018)
- [x] wire format — `CharacterDto.stage` is a canonical decimal string
      (`stageNumberSchema`). **Breaking change** for API clients; `apps/web`
      is updated in the same change
- [x] Game Core — `HugeNumber.pow` accepts a `bigint` exponent through the same
      multiplication sequence. `simulateStages` uses `StageNumber`, and
      `highestStageCleared` is `null` when nothing was cleared. No outcome
      changed: the Phase 1 golden fingerprints and transcript pass unmodified,
      and `GAME_RULES_VERSION` stays 1
- [x] web — `formatStage` displays the string exactly through `BigInt`
- [x] provisioning result reviewed — the boolean `created` (201/200) is kept.
      The rationale is in ADR-018
- [x] auth review — every listed behaviour already had a test. One gap was
      closed: a unit test proves sign-out hides player data while the network
      call is still pending (the previous test's fake resolved instantly)
- [x] database review — `CHECK (stage >= 1)`, `bigint`, RLS with no policies
      and the revoked `anon`/`authenticated` privileges are unchanged. No
      migration was needed
- [x] GitHub Actions on this change — green on PR #5 (run #12, `0965366`) and on
      `main` after the merge (run #13, `fb3db8b`)

Auth checklist — where each behaviour is proven:

| Behaviour                                          | Test                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| account switch clears TanStack Query               | `auth-provider.test.tsx` (unit), `auth.spec.ts` "next account never sees…"    |
| sign-out clears player data before the network     | `auth-provider.test.tsx` "hides player data before the sign-out request…" (new) |
| expired session clears state                       | `auth-provider.test.tsx`, `authorized-json.test.ts`, `auth.spec.ts` (expired) |
| invalid / tampered / unsigned JWT rejected         | `jose-access-token-verifier.test.ts`, `player.api.test.ts`                    |
| anonymous Supabase token rejected                  | `jose-access-token-verifier.test.ts` "rejects an anonymous sign-in"           |
| wrong issuer / audience rejected                   | `jose-access-token-verifier.test.ts`                                          |
| `service_role` (and `anon`) token rejected         | `jose-access-token-verifier.test.ts` "rejects the %s role"                    |
| another player's character not retrievable         | repository and HTTP integration tests, `player.api.test.ts`                   |

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- format check, lint, typecheck, production build: pass (whole workspace).
- Unit tests: 614 pass (previously 536). New or changed tests:
  - `game-core` 377: StageNumber properties, exact classification beyond 2^53,
    OVERFLOW at the maximum, `bigint` powers.
  - `contracts` 54: the wire schema.
  - `api` 95: domain ↔ wire agreement.
  - `web` 32: `formatStage` and the sign-out ordering test.
- Game Core purity: the guard test and ESLint rules pass unchanged.
- PostgreSQL integration: 28 pass (previously 22). Stages 5·10^9, 2^53 + 1 and
  2^63 − 1 read back exactly. A provisioned stage above 2^53 is written as a
  `bigint`. The database rejects −1 and 2^63. `GET /player/state` returns
  `"stage":"9223372036854775807"`.
- Migrations applied to an empty database: no drift from the Prisma schema.
- Supabase roles simulated: migrations applied to a database where `anon` and
  `authenticated` exist and have default privileges. Afterwards neither role
  holds SELECT, INSERT or UPDATE on `profiles` or `characters`. RLS is enabled
  with zero policies.
- Playwright E2E: 34 pass, mobile and desktop. The registration scenario now
  also asserts the rendered stage.
- Browser bundle built with the canary service-role key: clean.

---

# Phase 3 — First Gameplay Loop

Status: MERGED — PR #6 merged to `main` after CI run #25; the user started
Phase 4 on 2026-09-23

Goal:

Authenticated player → current stage → enemy → combat → win/loss → persisted
reward, experience, level and stage → boss every 10th stage → authoritative
state back to a mobile-first game screen with a PixiJS combat scene → repeat.

Decision: ADR-019. Gameplay decision taken with it, for the owner's review:
**a lost combat falls back one stage** (`stagesLostOnDefeat = 1`). Without it
the loop deadlocks at the first wall, because combat is the only progression
source in Phase 3 (docs/GAME_DESIGN.md — "Progression rules v1").

Tasks:

- [x] Phase 2 closed — CI green on `main` (run #13, `fb3db8b`), approved
- [x] ADR-019 — written before implementation: seed custody, Game Core
      authority, pacing, optimistic concurrency, idempotency, replay,
      persistence, offline attachment point
- [x] Game Core — `resolveStageAttempt` (enemy, combat, rewards, level-up,
      stage advance or fallback), level rule, `StageNumber.stepBack`,
      `describeProgress`. Rules v1 extended in place; `GAME_RULES_VERSION`
      stays 1 (no prior persisted result, no changed outcome; Phase 1
      fingerprints unmodified). Golden fingerprints for stage attempts added
- [x] persistence — migration `gameplay_loop`: experience and gold as
      HugeNumber pairs, `next_combat_at`, `version` on `characters`;
      `combat_runs` with replay inputs and audited summary, unique
      `(character_id, idempotency_key)`, ledger CHECKs, RLS
- [x] combat history — inputs + summary, no event log (regenerated
      deterministically; replays verified against the summary)
- [x] seeds — 256-bit CSPRNG per combat, never from or to the client
- [x] use case — `RunCombatUseCase`: one owner-scoped read, simulation outside
      the transaction, one conditional two-statement transaction
- [x] concurrency — optimistic version check; 25-request storms and retries
      across two API instances produce exactly one combat
- [x] idempotency — `Idempotency-Key` header; 201 new, 200 replay
- [x] pacing gate — `409 COMBAT_NOT_READY` + `Retry-After` until the combat's
      simulated duration has passed on the server clock
- [x] API contract — `CombatResponse`, HugeNumber wire schema via Game Core
      (ADR-013 edge), `progression` in player state (encounter `null` beyond
      the rule set's reach)
- [x] security — authentication, ownership in read and write, header
      validation, body ignored, no seed/owner/version in responses
- [x] Supabase — `supabase/` CLI structure (generated, adapted: Prisma owns
      migrations), docs/DEPLOYMENT.md with variables, workflow and owner
      checklist; no credentials
- [x] game screen — mobile-first HUD, battlefield, report, single action;
      boss treatment from the server's stage kind; every UX state
- [x] PixiJS — `CombatScene` adapter, lazy procedural scene, lifecycle-safe
      (StrictMode, late init, full destroy), canvas fallback, DOM mirror
- [x] client state — TanStack Query cache updated from the authoritative
      response; screen keyed by user; retries reuse the key
- [x] Vercel preparation — build guard (missing public config on Vercel,
      privileged `NEXT_PUBLIC_` names anywhere); owner steps documented
- [x] documentation — ADR-019, ARCHITECTURE, GAME_DESIGN, DATABASE, SECURITY,
      UI_SYSTEM, DEPLOYMENT, README, ADR index
- [x] GitHub Actions green on the pull request — PR #6, run #17 on `ee23348`:
      quality (format, lint, typecheck, unit tests, build), PostgreSQL
      integration and smoke, Playwright end-to-end. Runs #14 and #15 on
      intermediate commits failed on a test type error, fixed in `ee23348`
- [x] final audit — CI typecheck fix, stage progression model (ADR-020),
      `STAGE_NOT_PLAYABLE`; see "Final audit" below
- [x] GitHub Actions green on the final audit commits — run #24 on `b5b22c2`
      and run #25 on `610e633`: quality (format, lint, typecheck, unit
      tests, build), PostgreSQL integration and smoke, Playwright end-to-end
- [ ] Supabase DEV project created and migrated — OWNER ACTION
      (docs/DEPLOYMENT.md)
- [ ] Vercel deployment — OWNER ACTION, and a playable deployment is
      BLOCKED on the API host decision (ADR-012, owner decision)
- [x] merged — PR #6

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- `pnpm run verify` (format check, lint, typecheck, unit tests, production
  build): pass, whole workspace.
- Unit and application tests: 830 pass (Phase 2: 614) — `game-core` 429,
  `contracts` 95, `api` 136, `web` 105, `config` 33, `ui` 18, `database` 10,
  `worker` 4.
- PostgreSQL integration (`pnpm run test:integration`): 55 pass (Phase 2:
  28), five consecutive runs without a failure. Covered: token → combat →
  persistence → response; 25 simultaneous combats on stage 9 (one 201,
  twenty-four 409, one reward, stage 10); 25 simultaneous retries of one key
  (one 201, twenty-four 200, one row); eight intents × three retries across
  two API instances (exactly one combat); a 30-combat session whose ledger
  reconciles to the balance; replay from the database byte-identical; boss
  defeat fallback at stage 4·10^9; a too-deep stage failing without writes;
  stale-version and foreign-owner commits writing nothing; ledger CHECKs; RLS.
- Playwright E2E: 42 pass (21 scenarios × mobile 390x844 and desktop),
  including fight → reward → next stage → next enemy → reload; one request per
  burst of taps; a boss stage and its defeat; a second account starting
  clean. The Pixi scene reports ready in headless Chromium; assertions read
  the DOM, never pixels.
- Migrations applied to an empty database on which Supabase's `anon` and
  `authenticated` roles exist with default privileges: no drift (`prisma
  migrate diff --exit-code`); RLS on `profiles`, `characters` and
  `combat_runs` with zero policies; neither role holds any privilege.
- Browser bundle built with the canary service-role key: clean. PixiJS is in
  two lazy chunks referenced by no page's initial HTML.
- Game Core purity: guard test and ESLint unchanged and passing; the web app
  may import only `HugeNumber` from Game Core.
- Deterministic replay: Game Core golden fingerprints, property tests, the
  use case's equality with a direct Game Core call, and replay-from-database.
- Self-review fixed before commit: a pacing-gate clock mismatch for new
  characters, a 500 on player state for stages beyond the rule set's reach, a
  `useCombatScene` state that stayed "ready" across a scene re-creation, a
  frame of stale playback time, lunges drifting under overlapping attacks,
  tweens outliving destroyed actors, actors colliding with the DOM overlays
  (found by screenshot review), a type error Vitest does not catch, and a
  test that re-implemented the boss rule.

## Phase 3 final audit (2026-09-23)

Scope: the PR #6 audit. The work stays inside Phase 3: no Phase 4 work, no
rankings and no stage selection.

- [x] CI typecheck — runs #14 and #15 failed with `TS18047:
      'description.encounter' is possibly 'null'` in
      `stage-attempt.test.ts`. Vitest does not typecheck, so the unit run
      passed. Fixed with optional chaining, which still fails the assertion
      if the encounter is `null`. No `any`, no suppression, no configuration
      change
- [x] stage progression model (ADR-020) — `current / highestReached /
      highestCleared` (`null` before the first victory). The Game Core
      transition is `advanceStageProgress`, with invariants in Game Core, in
      the database and in the contract
- [x] normal-defeat rule evaluated — uniform fallback kept and documented. It
      avoids a deadlock, and no regular-stage losses occur under v1
- [x] migration `20260923090000_stage_progression` — rename to
      `current_stage`, two record columns with CHECKs, and the records before
      each combat on `combat_runs`. The backfill claims a clear only when a
      recorded win proves it. Verified from an empty database, from the Phase 2
      schema and from Phase 3 data, with no drift
- [x] contracts — the three fields in `progression` (player state, combat,
      and now `CharacterResponse`) and in the combat snapshots.
      `CharacterDto.stage` removed (**breaking** for API clients; `apps/web`
      updated in the same change)
- [x] `409 STAGE_NOT_PLAYABLE` — for a valid stage the rules cannot scale,
      refused before a seed is drawn. Replaces the former 500
- [x] UI — the HUD shows the current stage and a compact "Best" (highest
      cleared; "—" before the first clear). The row wraps instead of
      overflowing at 390 px. Screenshots were reviewed at stage 10 (boss),
      4·10^9 (boss) and 1 234 567
- [x] rules version — `GAME_RULES_VERSION` stays 1. The combat and reward
      fingerprints recorded before the refactor are pinned unchanged.
      `RULES_V1` is immutable once PR #6 is merged
- [x] review — Codex finding (a loss could spend experience banked by a
      gain capped at `MAX_LEVELS_PER_GAIN` and grant levels) fixed: experience
      is applied only on a win. A regression test fails on the previous code.
      Reachable outcomes are unchanged, so the golden fingerprints still pass
- [x] documentation — ADR-020, ADR-019 amendment, ADR index, ARCHITECTURE,
      GAME_DESIGN (future FARM / CHALLENGE BOSS / auto modes, ranking on
      `highestStageCleared`), DATABASE, SECURITY

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- `pnpm run verify` (format check, lint, typecheck, unit tests, production
  build): pass, whole workspace, 13/13 typecheck tasks.
- Unit and property tests: 868 pass (before the audit: 830). By package:
  `game-core` 444, `contracts` 107, `api` 145, `web` 107, `config` 33, `ui` 18,
  `database` 10, `worker` 4. New or changed tests:
  - the full audit transition matrix, farming, the uniform defeat rule, a
    zero fallback, exactness beyond 2^53, and invariant rejection;
  - a 500-run property test that the records are monotonic, the invariants
    hold, a defeat never clears and a victory clears at most the stage fought;
  - contract invariants, including one only visible beyond 2^53;
  - the use case's boss-loss records;
  - 25 idempotent retries moving the records once;
  - `STAGE_NOT_PLAYABLE` drawing no seed;
  - HUD best-cleared rendering.
- PostgreSQL integration: 64 pass (before the audit: 55), five consecutive
  runs. New checks:
  - a boss loss on stage 10 persists `9 / 10 / 9` with `combat_runs.stage = 10`;
  - 25 concurrent intents on stage 9 give `10 / 10 / 9`;
  - 25 retries of one key give `2 / 2 / 1`;
  - in a 30-fight session the records never decrease, and
    `highest_stage_cleared` equals the highest recorded win;
  - the stage-progress CHECKs on both tables;
  - `STAGE_NOT_PLAYABLE` leaves the row byte-identical.
- Playwright E2E: 42 pass (mobile 390x844 and desktop). New checks: "Best"
  before and after the first win, and after a boss defeat and a reload.
- Migrations: an empty database, a Phase 2 database and Phase 3 data all
  migrate cleanly, and `prisma migrate diff --exit-code` reports no drift.
- Browser bundle built with the canary service-role key: clean. Game Core
  purity: unchanged and passing.

Not in this phase, by design: offline progression, items, skills, prestige,
rankings, PvP, auto-battle, combat history endpoints, general rate limiting,
the generic idempotency table, and hosting the API (ADR-012).

# Phase 4 — Offline Progression

Status: COMPLETE / APPROVED — PRs 4.1–4.4 merged and manually verified

Phase 4 is delivered as a sequence of PRs, one at a time. Each waits for the
user's approval before the next begins.

## PR 4.1 — Stage Selection & Farming

Status: MERGED — PR #9. Decision: ADR-021 (accepted).

Scope: the foundation auto-battle and offline progression attach to — where
the hero fights and what a victory does to that position. No auto-battle,
timers, background combat, worker jobs, offline rewards or
`last_processed_at`.

- [x] Game Core — `StageMode` (`PROGRESS` / `FARM`), `selectStage` (bound
      `1 … highestReached`, `STAGE_LOCKED`), `advanceStageProgress` and
      `resolveStageAttempt` take the mode. Records move identically in both
      modes; a farm win stays on the stage. `GAME_RULES_VERSION` stays 1:
      Phase 3 golden fingerprints unchanged, a new FARM golden vector added
- [x] persistence — migration `20260923140000_stage_selection`: enum
      `stage_mode`, `characters.stage_mode` (default `PROGRESS`),
      `combat_runs.stage_mode` (replay input, backfilled `PROGRESS`, no
      default). `current_stage` is reused as the selected stage
- [x] use case — `SelectStageUseCase`: owner-scoped read, Game Core
      validation, version-conditional write of `current_stage` and
      `stage_mode` only, bounded re-validation on conflict, no-op when
      unchanged
- [x] API — `PUT /player/characters/:characterId/stage-selection`;
      `409 STAGE_LOCKED`, `409 CONCURRENT_UPDATE`
- [x] combat — reads the mode from persisted state, records it, replays with
      it; transaction, idempotency and pacing unchanged
- [x] contracts — `stageModeSchema`, `progression.stageMode`,
      `stageSelectionRequestSchema` (strict), `stageSelectionResponseSchema`,
      two error codes
- [x] web — `StageSelector` under the HUD: summary + "Change", radio choice
      "Continue climbing" / "Stay on this stage", bigint stepper and typed
      stage, range hint, validation, overlay panel at 390×844, no optimistic
      update; defeat text "stays on stage N" when farming
- [x] fix found while testing — an oversized request body (`413` from the
      body parser) was answered as a logged `500`; the exception filter now
      keeps exposed 4xx statuses from Express middleware
- [x] documentation — ADR-021, ARCHITECTURE, GAME_DESIGN, DATABASE,
      SECURITY, UI_SYSTEM
- [x] GitHub Actions green on the pull request
- [x] user review and approval — merged as PR #9; PR 4.2 started 2026-09-23

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- format check, lint, typecheck, production build: pass.
- Unit tests: 1 025 pass (Phase 3 final: 868) — `game-core` 473,
  `contracts` 141, `api` 198, `web` 148, `config` 33, `ui` 18, `database` 10,
  `worker` 4.
- PostgreSQL integration: 81 pass (was 64), five consecutive runs. New:
  selection persisted across a fresh API process and a new token; a farm
  stage of 2^53 + 1 stored and served exactly; locked stage leaves the row
  byte-identical; 20 farm wins below an unbeaten stage-100 boss keep
  `99 / 100 / 99` with every run recorded as `FARM`; climbing after farming
  fights the boss; replay after a mode change; selections, climbs and combats
  racing across two API instances keep every invariant; stale and
  foreign-owner selection writes rejected; enum and CHECK constraints.
- Playwright: 46 pass (was 42), mobile 390×844 and desktop; the new scenario
  (register → fight twice → locked stage refused → farm stage 1 → farm win →
  reload → sign out/in → climb again → fight) and a keyboard-only scenario;
  both stable over three repeats.
- Migrations: applied to the development database and to a database with
  Phase 3 data (characters farming and climbing, a recorded boss loss):
  every row backfilled `PROGRESS`, no other value changed; `prisma migrate
  diff --exit-code` reports no drift.

Deferred to PR 4.2+: auto-battle, offline progression (`last_processed_at`,
elapsed time, cap, rewards, claim, the generic idempotency table, summary UI)
and the decision whether an offline run may climb or only farm.

## PR 4.2 — Online Auto Battle

Status: MERGED — PR #10. Decision: ADR-022 (accepted).

Scope: while the game is open and visible, the client keeps fighting through
the existing server-authoritative combat. **Online auto-battle is not offline
progression**: it needs an active client sending one ordinary combat request
per fight, and nothing is computed for time the client was closed, hidden or
asleep. No offline rewards, `last_processed_at`, worker jobs, server loops,
Redis, WebSockets, migrations or contract changes.

- [x] audit — the Phase 3 pacing gate (`next_combat_at`, `409
      COMBAT_NOT_READY` + `Retry-After`), idempotency key, `version` check
      and persisted stage mode already bound a repeating client; reused
      unchanged. No rate limiter exists (documented, not added)
- [x] web — `auto-battle/auto-battle.ts`: pure intent reducer (`off`,
      `running`, `stopping`, `halted`) and `nextAutoBattleStep` (when to send
      the next fight); `useAutoBattle` drives the existing
      `useCombatSession().fight` with one timer; `usePageVisible`
- [x] web — timing from the server's `nextCombatAt` only; no catch-up;
      paused while the page is hidden; waits for a pending stage choice
- [x] web — failures: same-key backoff (2–30 s) for transient errors and
      429, re-read and new key after `COMBAT_NOT_READY`, halt with a reason
      on 401/403/404/`STAGE_NOT_PLAYABLE`/repeated failure
- [x] web — `BattleControls`: **Fight** + **Auto battle** when off, **Stop
      auto battle** when on, status line (mode, paused/waiting, countdown);
      the stage selector is locked only while a combat request is in flight
- [x] web — combat failures classify 429 (`limited`, retryable) and other
      4xx (`rejected`, final) instead of treating them as outages
- [x] api — structured log events `combat.replayed`, `combat.conflict`,
      `combat.stage_not_playable`, `combat.not_ready` (debug);
      `PinoLoggerService` records object messages as fields
- [x] documentation — ADR-022, ADR-021 accepted, ARCHITECTURE, GAME_DESIGN,
      SECURITY, UI_SYSTEM
- [x] GitHub Actions green on the pull request
- [x] user review and approval — merged as PR #10; PR 4.3 started 2026-09-23

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- format check, lint, typecheck, production build: pass.
- Unit tests: 1 075 pass (PR 4.1: 1 025) — `api` 206 (+8: log events,
  structured logger), `web` 190 (+42: reducer, step function, game screen
  auto-battle scenarios, failure classification); other packages unchanged.
- PostgreSQL integration: 96 pass (was 81), three consecutive runs. New
  `auto-battle.int.test.ts`: PROGRESS loop on server-named stages with a
  reconciled ledger; FARM loop stays put; FARM on the uncleared frontier boss;
  mode and stage changes between fights; a selection does not open the gate;
  1 ms early refused with `Retry-After`; 60 spam requests write nothing; a
  greedy 4 req/s client for 40 s never overlaps combats; lost-response retry
  replays; two tabs across two API instances get one combat per window; a
  phone on auto and a desktop by hand; a farm stage of 4·10⁹ exact; stage
  2^53 + 1 refused `STAGE_NOT_PLAYABLE` with nothing written; missing,
  expired, forged and foreign tokens.
- Playwright: 52 pass (was 46), mobile 390×844 and desktop: farm on auto →
  several committed fights on stage 2 → stop (no request for 12 s) → climb
  on auto from the frontier → refresh keeps the server state with auto off;
  two tabs on auto (database proves no overlapping combats); sign-out stops
  the loop and sign-in starts with it off. Screenshots reviewed at 390×844:
  no horizontal overflow.
- Migrations: none.

Deferred to PR 4.3: offline progression — `last_processed_at`, elapsed
server time, cap, rewards, claim, the generic idempotency table, summary UI.

## PR 4.3 — Server-Authoritative Offline Progression

Status: MERGED / APPROVED. Decision: ADR-023 (accepted).

**AFTER MERGE: run the GitHub Action "Deploy Supabase DEV"** before deploying
the API: migration `20260923180000_offline_progression` must reach the
database first (docs/DEPLOYMENT.md).

Scope: lazy, server-authoritative catch-up of idle time, claimed on return.
No worker, scheduler, timer, Redis, WebSocket or service-worker simulation.
The polished "welcome back" presentation is PR 4.4.

- [x] audit — PR 4.2 merged (#10); `next_combat_at` already is the processed
      boundary (ADR-019 §10), so no separate `last_processed_at` column
- [x] Game Core — `resolveOfflineProgress` (pure; composes enemy, combat,
      rewards and level rules fight by fight), `offlineFarmStage`
      (`min(current, highestCleared)`, none before the first clear),
      `MAX_OFFLINE_FIGHTS = 30 000` (`LIMIT_EXCEEDED`), `RULES_V1.offline`
      (cap 8 h — owner-adjustable; minimum absence 1 min). Equivalence with
      repeated FARM `resolveStageAttempt` proven; `GAME_RULES_VERSION` stays 1
- [x] persistence — migration `20260923180000_offline_progression`:
      `characters.offline_seed` (non-re-rollable claim seed), `offline_runs`
      (replay inputs + audited summary, unique `(character_id,
      idempotency_key)`, time-line, target ≤ cleared, count, ledger and
      HugeNumber CHECKs, RLS, revokes). Individual offline fights are not
      written to `combat_runs`
- [x] use case — `ClaimOfflineProgressUseCase`: one owner-scoped read, replay
      from stored summary, server-clock elapsed, no write when nothing fits,
      one version-conditional transaction (level, experience, gold, boundary,
      next seed + record; never a stage column), bounded re-resolution on
      conflict
- [x] API — `POST /player/characters/:characterId/offline-progress`
      (`Idempotency-Key`, no body): 201 collected, 200 replay / nothing,
      400, 401, 404, 409 `CONCURRENT_UPDATE`
- [x] contracts — `offlineProgressSchema`, `offlineProgressResponseSchema`,
      `offlineIdleReasonSchema`
- [x] web — claim on entry and on return to a visible page, before any fight
      or auto-battle step; minimal summary panel; same-key retry; "play
      without it"
- [x] observability — `offline.processed`, `offline.capped`,
      `offline.replayed`, `offline.noop`, `offline.conflict`,
      `offline.rejected`
- [x] documentation — ADR-023, ADR-022 accepted, ARCHITECTURE, GAME_DESIGN,
      DATABASE, SECURITY, DEPLOYMENT, UI_SYSTEM
- [ ] GitHub Actions green on the pull request
- [ ] user review and approval

Validation (2026-09-23, local, PostgreSQL 16 and Redis 7):

- `pnpm run verify` (format check, lint, typecheck, unit tests, production
  build): pass.
- Unit tests: 1 186 pass (PR 4.2: 1 075) — `game-core` 516 (+43: offline
  resolution, farm target, cap, equivalence, property, bounded work, rules
  registry), `contracts` 155 (+14), `api` 242 (+36: use case, HTTP),
  `web` 208 (+18); other packages unchanged.
- PostgreSQL integration: 119 pass (was 96). New `offline-progress.int.test.ts`
  (23): atomic commit, stored claims replay exactly, chained boundaries,
  no-clear and 2^53 + 1 no-ops, 28 800-fight claim with enormous gold, the
  same key 100 times, 100 keys across two instances (one claim), lost-response
  retry on another instance, combat and selection races, auto-battle-style
  online play then absence, forced rollback, stale and foreign-owner commits,
  CHECK constraints, uniqueness, RLS.
- Playwright: 60 pass (was 52), mobile 390×844 and desktop: away 3 h →
  summary → server-recorded claim matches → continue → refresh pays nothing
  again; no cleared stage; temporary failure + same-key retry; 401 on the
  claim ends the session. Screenshot reviewed at 390×844: no overflow.
- Migrations: applied to the PR 4.2 schema with data and to an empty database
  with Supabase-like `anon`/`authenticated` roles; `prisma migrate diff
  --exit-code`: no drift; `offline_runs` has RLS, no policies, no privileges
  for those roles.
- Benchmark (`vitest bench`, Node 22): 5 min ≈ 1.2 ms; 1 h ≈ 27 ms; 8 h at
  stage 9 ≈ 241 ms; 8 h at stage 1 000 (28 800 fights) ≈ 364 ms mean,
  406 ms p99; heap growth < 10 MB. A claim is 2 SELECTs + 1 UPDATE +
  1 INSERT; a replay or no-op is the read only.

## PR 4.4 — Return experience

Status: MERGED / APPROVED — welcome-back presentation over the unchanged PR 4.3 claim.

- [x] Meaningful claims open a mobile-first reward dialog with time away,
      precision-safe Gold and XP, battles, victories, farmed stage, level
      progression and the hero's current level.
- [x] The 8-hour cap is acknowledged as a successful maximum reward, while
      zero-fight claims remain silent.
- [x] Focus moves into the dialog, keyboard focus is contained, explicit
      Continue/recovery actions are required, and reduced motion removes all
      staged entrances.
- [x] Manual and auto battle wait until the presentation or recovery choice is
      complete. Continue is presentation-only and never sends a second claim.
- [x] Retry keeps the original idempotency key; refresh stores no summary in
      browser persistence and asks the server normally.
- [x] No API, contract, database, Game Core or gameplay-rule changes.

## Phase 4 scope (whole phase)

Implement:

- lastProcessedAt
- server-authoritative time
- elapsed progress
- offline cap
- offline rewards
- claim
- idempotency
- offline summary UI
- edge case tests

---

# Phase 5 — Items & Equipment

Status: COMPLETE

## PR 5.1 — Item Domain Foundation

Status: COMPLETE / APPROVED. Decision: ADR-024.

Scope: pure, immutable item identities, definitions, instances, slot and
rarity values, and a seven-entry static catalog in Game Core. No persistence,
inventory, equipment state, drops, API, contracts or UI.

Implement slots:

Weapon
Helmet
Chest
Gloves
Boots
Ring
Amulet

Implement rarity:

Common
Magic
Rare
Epic
Legendary
Mythic

Implement:

ItemDefinition
ItemInstance
Inventory
Equip
Unequip
Drops
Persistence


## PR 5.2 — Inventory & Equipment Persistence

Status: COMPLETE / APPROVED. Decision: ADR-025.

## PR 5.3 — Item Drops & Combat Reward Integration

Status: COMPLETE / APPROVED. Decision: ADR-026. Deterministic online victory drops, atomic persistence and exactly-once replay are implemented. Offline item rewards are explicitly deferred pending a bounded aggregate design.

## PR 5.4 — Inventory & Equipment UI

Status: COMPLETE.

- [x] authenticated `/play/gear` route with responsive loadout and inventory
- [x] authoritative Equip, replacement and Unequip flows through the existing API
- [x] centralized accessible rarity presentation and deterministic inventory derivation
- [x] combat item-found presentation with inventory cache synchronization
- [x] loading, empty, retryable error and mutation-pending states
- [x] unit and Playwright coverage for persistence, replacement, empty state and mobile project

---

# Phase 6 — Item Power & Character Stats

Status: IN PROGRESS

## PR 6.1 — Character Stats & Modifier Foundation

Status: IN PROGRESS — review pending. Decision: ADR-027.

- [x] canonical current-combat character stat taxonomy
- [x] pure, rules-aware base derivation
- [x] generic flat and additive-percent modifiers with traceable sources
- [x] deterministic resolution, half-to-even rounding and invariant clamps
- [x] large-number, ordering, validation and immutability tests
- [x] architecture/game-design documentation
- [ ] review and approval

## PR 6.2 — Item Power & Affixes

Status: NOT STARTED

## PR 6.3 — Equipment Stats & Combat Integration

Status: NOT STARTED

## PR 6.4 — Character Stats UI

Status: NOT STARTED

Later effect mechanics such as bleed, poison and fire damage are not character
stats in PR 6.1 and remain deferred. Content must remain data-driven.

---

# Phase 7 — Active Skills

Status: NOT STARTED

Initial candidate skills:

Whirlwind
Fireball
Execute
Blood Strike
Lightning Chain
Shield

Implement skill levels and cooldown architecture.

---

# Phase 8 — Passive Tree

Status: NOT STARTED

Initial content:

approximately 100 nodes.

Architecture must support significantly more.

Implement:

prerequisites
branches
cost
allocation
respec
validation.

---

# Phase 9 — Rebirth

Status: NOT STARTED

First prestige layer.

Implement:

reset rules
Souls
persistent upgrades
transaction safety
idempotency.

---

# Phase 10 — Leaderboards

Status: NOT STARTED

First ranking:

Highest Stage.

Implement:

Redis active leaderboard
PostgreSQL snapshots
pagination
player position
tie handling.

---

# Phase 11 — Tower of Eternity

Status: NOT STARTED

Implement:

endless tower
separate progression
roguelite blessings
Tower leaderboard.

---

# Phase 12 — Guilds

Status: NOT STARTED

Implement:

guild creation
membership
roles
invitations
progression
basic leaderboard.

---

# Phase 13 — World Boss

Status: NOT STARTED

Implement:

global boss
event duration
contribution
damage ranking
rewards
worker processing.

---

# Phase 14 — Arena PvP

Status: NOT STARTED

Implement:

asynchronous PvP
build snapshots
deterministic combat
rating
matchmaking
rewards.

---

# Phase 15 — Seasons

Status: NOT STARTED

Implement:

season definition
start/end
season progression
season modifiers
leaderboard
rewards
archival snapshot.

---

# Phase 16 — Eternal Forge

Status: NOT STARTED

Implement advanced crafting:

craft
upgrade
reroll
socket
rune
corrupt
awaken
ascend.

Operations must be:

server-authoritative
transactional
idempotent
auditable.

---

# Phase 17 — Companions

Status: NOT STARTED

Implement:

definitions
instances
progression
skills
evolution
equipment.

---

# Phase 18 — Advanced Prestige

Status: NOT STARTED

Implement architecture for:

Rebirth
Ascension
Transcendence
Apotheosis.

Each layer should unlock meaningful mechanics.

---

# Phase 19 — Achievements

Status: NOT STARTED

Implement achievements capable of unlocking:

mechanics
passive branches
titles
build options
cosmetics.

---

# Phase 20 — Production Hardening

Status: NOT STARTED

Audit:

architecture
security
database
indexes
API
rate limiting
economy
idempotency
performance
caching
concurrency
race conditions
accessibility
responsive design
PWA
logging
monitoring
backups.

Run complete test suite.

Document technical debt.

---

# Phase completion procedure

When finishing any phase:

1. run lint,
2. run typecheck,
3. run unit tests,
4. run integration tests where relevant,
5. run E2E where relevant,
6. run production build,
7. perform self-review,
8. update documentation,
9. change phase status,
10. provide completion report,
11. STOP.

Never automatically begin the next phase.
