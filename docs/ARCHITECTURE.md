# Eternal Forge — Software Architecture

Status: PARTIALLY IMPLEMENTED (Phases 0–2) / EVOLVING

The architectural style, boundaries and package layout described here are
IMPLEMENTED as of Phase 0. The headless Game Core simulation (HugeNumber, RNG,
versioned rules, combat, stages, rewards) is IMPLEMENTED as of Phase 1.
Authentication, player identity persistence and the first authenticated API are
IMPLEMENTED in Phase 2 (awaiting approval). Domain events, CQRS infrastructure, persistence of
gameplay progress, offline processing and leaderboards are PLANNED.

See the "Phase N implementation status" sections at the end of this document
for exactly what exists today, and `docs/adr/` for the decisions behind it.

---

# Architectural style

Eternal Forge uses:

Modular Monolith +
Clean / Hexagonal Architecture +
DDD-lite.

We intentionally avoid premature microservices.

---

# High-level architecture

Client
|
v
Next.js / React
|
v
NestJS API
|
+----------------+
| |
v v
Application Redis
|
v
Domain / Game Core
|
v
Repositories
|
v
PostgreSQL

Background work:

API
|
v
Queue
|
v
BullMQ Worker
|
+-> PostgreSQL
+-> Redis
+-> application services where appropriate

---

# Monorepo

apps/web

Responsible for:

- Next.js application,
- React UI,
- responsive layout,
- PWA,
- PixiJS combat visualization.

apps/api

Responsible for:

- HTTP API,
- authentication integration,
- application use cases,
- authorization,
- request validation.

apps/worker

Responsible for:

- background jobs,
- scheduled processing,
- leaderboard snapshots,
- season processing,
- world events,
- asynchronous reward processing.

---

# packages/game-core

Pure TypeScript.

Contains gameplay rules.

Must not know about:

- HTTP,
- database,
- React,
- Next.js,
- NestJS,
- Prisma,
- Redis,
- Supabase.

Status: IMPLEMENTED (Phase 1) — see "Phase 1 implementation status".

Allowed consumers of the pure `HugeNumber` value type (ADR-013): `packages/contracts`
for the wire schema, and `apps/web` for parsing, comparison and formatting input
only. Neither may use Game Core to decide a gameplay outcome (ADR-003).

---

# packages/contracts

Contains transport contracts shared between client/server.

Use Zod where appropriate.

Examples:

PlayerStateResponse
InventoryResponse
CombatResponse
LeaderboardResponse

Status: IMPLEMENTED for health, the shared API error body (`ApiErrorResponse`
with a machine-readable `code`), the player-name rule, the stage-number wire
format (`stageNumberSchema`, a canonical decimal string — ADR-018) and the
player contracts (`PlayerStateResponse`, `ProvisionPlayerRequest`,
`CharacterResponse`).

---

# packages/database

Contains data-platform infrastructure.

Responsibilities:

Prisma schema
Prisma client factory
Supabase client factories (privileged and public)
database-related infrastructure.

Supabase client construction lives here rather than in a separate package
because Supabase is the project's data platform — PostgreSQL, Auth and Storage
from one provider. The privileged client refuses to be constructed in a browser.

Redis connections are deliberately NOT here. A Redis connection is infrastructure
owned by the process that uses it, and the API and the worker need different
settings; each application constructs its own. See ADR-006.

Do not leak Prisma types into Domain.

Status: IMPLEMENTED. Phase 2 added the first models, `Profile` and
`Character`, with a versioned migration (ADR-011, ADR-017). Further tables
arrive with the phase that needs them.

---

# packages/ui

Reusable application UI.

Does not contain core gameplay rules.

Status: IMPLEMENTED — design tokens plus the `Alert`, `Button`, `Panel`,
`Skeleton`, `StatusBadge` and `TextField` primitives. Further components are created by the feature that
needs them (docs/UI_SYSTEM.md).

Unlike the other packages, `packages/ui` exports TypeScript source rather than a
build artefact; the consuming Next.js application compiles it through
`transpilePackages`. See ADR-008.

---

# packages/config

Runtime environment validation, shared by every application.

Two entry points, separated in the module graph rather than by convention:

- `@eternal-forge/config/server` — privileged configuration. Throws if imported
  in a browser runtime.
- `@eternal-forge/config/client` — browser-safe configuration only.

Nothing outside this package reads `process.env` for application settings.

Status: IMPLEMENTED. See ADR-010.

---

# packages/eslint-config and packages/typescript-config

Tooling configuration shared across the workspace: flat ESLint configurations
(including the Game Core purity rules) and TypeScript presets.

These configure the _toolchain_. `packages/config` configures the _runtime_.

Status: IMPLEMENTED. See ADR-008.

---

# Module architecture

Backend modules should follow domain boundaries.

Example:

combat/
domain/
application/
infrastructure/
presentation/

Do not mechanically create empty directories where they provide no value.

Use the structure as complexity appears.

---

# Domain Layer

Contains:

entities
value objects
domain services
domain rules
domain events

No infrastructure dependencies.

---

# Application Layer

Contains:

use cases
commands
queries
ports
application services

Coordinates domain behavior.

---

# Infrastructure Layer

Contains:

repository implementations
Prisma
Redis
external providers
queue implementations.

---

# Presentation Layer

Contains:

controllers
DTO mapping
HTTP-specific concerns.

---

# Game Core

The Game Core is designed as a deterministic simulation engine.

Example:

simulateCombat({
player,
enemy,
seed,
rulesVersion
})

returns a CombatResult.

It must be possible to execute this in a unit test without any external
services.

---

# RNG

Provide an explicit deterministic RNG abstraction.

Domain gameplay must not call Math.random directly.

The RNG seed should allow combat reproduction.

Status: IMPLEMENTED (Phase 1). xoshiro128** seeded from a server-chosen string
through cyrb128; child seeds via `deriveSeed`. See ADR-015.

---

# Rules version

Consider associating important deterministic simulations with a game rules
version.

Reason:

a replay created before a balance patch may otherwise produce a different
result after formulas change.

Exact implementation should remain simple until needed.

Status: IMPLEMENTED (Phase 1). `GAME_RULES_VERSION` names the rule set new
results are produced under; `getGameRules(version)` returns a frozen, versioned
rule set, and every simulation result records the version it ran under. See
ADR-015.

---

# HugeNumber

Gameplay values may exceed normal JavaScript numeric precision/range.

Provide a single abstraction.

Requirements:

- deterministic operations,
- serialization,
- comparison,
- addition,
- subtraction,
- multiplication,
- division where needed,
- formatting separate from arithmetic.

Do not couple UI formatting with mathematical representation.

Status: IMPLEMENTED (Phase 1) per ADR-013: an 18-digit decimal `bigint`
coefficient and a signed 32-bit exponent, half-to-even rounding, a canonical
string form and a two-part persistence form. Formatting is not part of it.

---

# Effects

Effects should become a generalized mechanism for build modification.

Possible conceptual structure:

Effect {
target
operation
value
conditions
trigger
}

Do not over-generalize the first implementation.

Build the smallest model that supports current mechanics while preserving
extension points.

---

# Domain Events

Potential events:

EnemyKilled
BossKilled
StageCleared
ItemDropped
LevelUp
AchievementUnlocked
PrestigePerformed

Events allow other modules to react without embedding all behavior into a
single god service.

---

# Repository pattern

Application/domain code uses repository interfaces.

Infrastructure implements them.

Example:

PlayerRepository

implemented by:

PrismaPlayerRepository.

Controllers must never call Prisma directly.

---

# CQRS

Use command/query separation where useful.

Commands modify state.

Examples:

EquipItem
UpgradeItem
AllocateSkillPoint
PerformRebirth
ClaimOfflineProgress

Queries read state.

Examples:

GetPlayerState
GetInventory
GetLeaderboard

Do not introduce unnecessary CQRS infrastructure for trivial operations.

---

# Transactions

Use database transactions for operations requiring atomicity.

Examples:

purchase
craft
upgrade
prestige
reward claim

Never allow half-completed economy operations.

---

# Idempotency

Critical commands should support idempotency.

Examples:

ClaimOfflineRewards
ClaimSeasonReward
CraftItem
Purchase
Prestige

Repeated delivery must not duplicate rewards.

---

# Offline architecture

Never run a permanent simulation loop for every offline player.

Persist enough state to calculate elapsed progress.

Server time is authoritative.

---

# Leaderboards

Active leaderboard access may use Redis sorted structures.

Persistent snapshots/history belong in PostgreSQL.

Do not use Redis as the only permanent leaderboard history.

---

# Deployment architecture

Initial target:

GitHub
|
+-> Vercel
| -> web
| -> compatible application services where appropriate
|
+-> Supabase
| -> PostgreSQL
| -> Auth
| -> Storage
|
+-> Redis provider

Worker deployment may be separated if execution requirements justify it.

Do not force all workloads into one provider when the runtime model is a poor
fit.

---

# Scalability strategy

Start with a modular monolith.

Scale vertically and through stateless API replicas where possible.

Use Redis/cache appropriately.

Move a module into a separate service only when measured requirements justify
the operational complexity.

---

# Architecture principle

Design boundaries for scale.

Do not build distributed infrastructure before scale exists.

---

# Phase 0 implementation status

What exists in the repository today.

## IMPLEMENTED

- pnpm workspace, Turborepo task graph, shared TypeScript and ESLint
  configuration, pnpm catalog for dependency versions (ADR-008).
- ESM-only workspace; `module`/`moduleResolution` set to `NodeNext` for
  Node-side code (ADR-009).
- `apps/api` — NestJS application with layered health module
  (`application` / `infrastructure` / `presentation`), a dependency-probe port,
  structured logging with credential redaction, correlation IDs, a safe global
  exception filter, Helmet and configured CORS.
- `apps/worker` — BullMQ worker with a pure job handler, graceful shutdown, and
  a smoke CLI that enqueues a job and waits for the result.
- `apps/web` — Next.js application: start page, system status page backed by
  TanStack Query, and its own liveness endpoint.
- `packages/game-core` — package boundary and its automated guard rails. No
  gameplay rules.
- `packages/contracts` — health transport contracts.
- `packages/database` — Prisma 7 client factory with the `pg` driver adapter,
  Supabase client factories, database probe port (ADR-011).
- `packages/config` — validated environment with a server/client split (ADR-010).
- `packages/ui` — design tokens and three primitives.
- CI: format, lint, typecheck, unit tests, build, Playwright end-to-end, and a
  backing-services smoke job running against real PostgreSQL and Redis.
- Generated code (the Prisma client) is produced by an explicit `db:generate`
  Turborepo task that every task reading the package depends on, so any task
  works on a clean checkout (ADR-014).

## NOT IMPLEMENTED

As of Phase 0 — Phase 1 has since implemented HugeNumber, RNG, combat, stages
and rewards; see "Phase 1 implementation status".

Everything gameplay-related. Specifically, and deliberately: HugeNumber, RNG,
combat, stages, rewards, items, effects, skills, passives, prestige, offline
progression, leaderboards, guilds, arena, seasons, authentication, persistence
of player state, domain events, CQRS infrastructure, rate limiting and PixiJS.

## Open architectural decisions

- Hosting for `apps/api` and `apps/worker` (ADR-012, deferred to Phase 2).

## Decided since Phase 0

- The `HugeNumber` representation, persistence format and
leaderboard ordering key were decided in ADR-013 (accepted 2026-09-22): a decimal
`bigint` coefficient with 18 significant digits plus a signed 32-bit exponent,
a canonical string on the wire, two columns in PostgreSQL and an integer
projection as the Redis score.

---

# Phase 1 implementation status

What Phase 1 added to `packages/game-core`. It is still the only package with
gameplay code; no application calls it yet.

## IMPLEMENTED

- `huge-number/` — `HugeNumber` (ADR-013): arithmetic, comparison, integer
  `pow`, `floor`, canonical `parse`/`toString`, lenient `fromDecimal` for
  content data, `toParts`/`fromParts` for the future persistence columns.
- `rng/` — `Rng`, `Xoshiro128StarStar`, `createRng`, `deriveSeed` (ADR-015).
- `rules/` and `rules-version.ts` — the `GameRules` model, `RULES_V1`, the
  version registry and `GAME_RULES_VERSION = 1`.
- `stats/` — `CombatStats`, shared by characters and enemies, with validation
  and rule caps. Rates are integer basis points.
- `character/`, `enemy/`, `stage/` — `createCharacter(level)`, `resolveStage`,
  and the single stage-scaling module that turns archetype data into enemies.
- `rewards/` — gold and experience per cleared stage.
- `combat/` — `simulateCombat({ player, enemy, seed, rulesVersion })` returning
  a `CombatResult` with an ordered event log for a future CombatScene.
- `simulation/` — `simulateStages`, the headless stage ladder.
- Guard rails: ESLint and the source-scanning guard test now also ban the
  implementation-approximated `Math` functions.
- Tooling outside the shipped build: `bench/` (`pnpm … run bench`) and
  `scripts/simulate-stages.ts` (`pnpm … run simulate`).

## NOT IMPLEMENTED

Everything that needs persistence, identity or presentation: authentication,
player state, applying rewards to an account, level-up from experience, items,
effects, skills, passives, offline progression, prestige, rankings, PvP and any
combat UI. The Zod wire schema for `HugeNumber`, the PostgreSQL columns and the
Redis ranking projection are deferred as recorded in ADR-013.


---

# Phase 2 implementation status

Status: IMPLEMENTED — CI green on PR #4; awaiting user approval. Decisions: ADR-016 (authentication) and ADR-017 (player identity
persistence).

## Request flow

```
Browser ──(email/password)──> Supabase Auth ──> access token (JWT)
   │
   │  Authorization: Bearer <access token>
   v
apps/api
  AuthGuard (global, default-deny) ── AccessTokenVerifier port
                                      └─ JoseAccessTokenVerifier (JWKS / legacy HS256)
  PlayerController (thin: validate with shared Zod contract, call use case, map)
  GetPlayerStateUseCase / ProvisionPlayerUseCase / GetOwnedCharacterUseCase
  PlayerRepository port
  PrismaPlayerRepository ──> PostgreSQL (profiles, characters; RLS enabled)
```

## Module layout (apps/api)

```
common/clock/        Clock port and a global ClockModule
common/http/         ApiException, AllExceptionsFilter, ZodValidationPipe, request ids
auth/
  application/       AuthenticatedIdentity, AccessTokenVerifier port
  infrastructure/    JoseAccessTokenVerifier
  presentation/      AuthGuard, @Public(), @CurrentIdentity(), bearer extraction
player/
  domain/            Profile, Character, Player, PlayerName (value object)
  application/       use cases, PlayerRepository port
  infrastructure/    PrismaPlayerRepository
  presentation/      PlayerController, domain → contract mapping
```

## Endpoints

| Method | Path                               | Auth     | Result                                                              |
| ------ | ---------------------------------- | -------- | ------------------------------------------------------------------- |
| GET    | `/health`, `/health/ready`         | public   | unchanged                                                           |
| GET    | `/player/state`                    | required | 200 `PlayerStateResponse`, or 404 `PLAYER_NOT_PROVISIONED`          |
| POST   | `/player`                          | required | idempotent provisioning; 201 created, 200 already existed           |
| GET    | `/player/characters/:characterId`  | required | 200 own character; 404 `NOT_FOUND` for missing *or someone else's* |

Every error body follows `ApiErrorResponse`: `statusCode`, `code`, `error`,
`requestId`, optional `issues`. 401 responses carry an RFC 6750
`WWW-Authenticate` challenge; 503 `AUTH_UNAVAILABLE` means the signing keys could
not be fetched, not that the session is invalid.

## Web application

- `AuthProvider` (React context) mirrors the Supabase session: loading,
  authenticated (user id) or unauthenticated (with a reason). It clears the whole
  TanStack Query cache whenever the user changes or signs out.
- `authorizedJson` attaches the bearer token, refreshes once on 401 and ends the
  session locally if the API still refuses.
- Routes: `/login`, `/register` (guest only), `/play` (requires sign-in; player
  shell or first-run "Name your hero" onboarding). Route guards are navigation,
  not security.

## Tests

- Unit and application tests run without services.
- `apps/api` HTTP tests run the real guard, verifier, controller and filter
  with an in-memory repository.
- `apps/api/test-integration` runs the Prisma repository and the full HTTP path
  against a real PostgreSQL (`pnpm run test:integration`), including
  concurrency, constraints and Row Level Security.
- Playwright runs the production web build against the real API and PostgreSQL,
  with a GoTrue test double as identity provider (ADR-016).

## Stage numbers (Phase 2 hardening, ADR-018)

A stage is Game Core's `StageNumber`: an exact `bigint` from 1 to 2^63 − 1,
never a JavaScript `number`. It is the type of `Stage.number` in Game Core and
of `Character.stage` in the API domain and repository port. The Prisma adapter
converts it to and from the `bigint` column without loss. On the wire it is the
canonical decimal string. The web application only formats it for display,
through `BigInt`. This makes `apps/api` a consumer of `@eternal-forge/game-core`.

## NOT IMPLEMENTED

Gameplay persistence (experience, gold, stage progression), level-up, combat UI,
rate limiting, account deletion, email change and password reset screens,
display-name uniqueness, and a production host for the API (ADR-012 remains
open).
