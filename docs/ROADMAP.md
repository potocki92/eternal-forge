# Eternal Forge — Development Roadmap

Last updated: 2026-09-22

# Current Phase

PHASE 2 — AUTHENTICATION & PLAYER

Status:

IN PROGRESS — implementation complete and validated locally; awaiting green CI
on the pull request and user approval. See "Validation" under Phase 2.

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

Status: IN PROGRESS — implemented and validated locally (2026-09-22); awaiting
green CI on the pull request and user approval. Phase 3 must not start without
that approval.

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
- [ ] GitHub Actions green on the pull request
- [ ] user approval

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

---

# Phase 3 — First Gameplay Loop

Status: NOT STARTED

Implement:

Combat
-> enemy defeated
-> reward
-> next stage
-> boss
-> progression.

Create first mobile-first game screen.

Introduce PixiJS CombatScene.

Game Core remains authoritative.

---

# Phase 4 — Offline Progression

Status: NOT STARTED

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

Status: NOT STARTED

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

---

# Phase 6 — Affixes & Effects

Status: NOT STARTED

Implement generalized modifier/effect system.

Initial mechanics:

Damage
Attack Speed
Crit Chance
Crit Damage
Bleed
Poison
Fire Damage

Content must remain data-driven.

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
