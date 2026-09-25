# Eternal Forge — Software Architecture

Status: PARTIALLY IMPLEMENTED (Phases 0–5, Phase 6 PR 6.1) / EVOLVING

The architectural style, boundaries and package layout described here are
IMPLEMENTED as of Phase 0. The headless Game Core simulation (HugeNumber, RNG,
versioned rules, combat, stages, rewards) is IMPLEMENTED as of Phase 1.
Authentication, player identity persistence and the first authenticated API are
IMPLEMENTED in Phase 2. The first persistent gameplay loop — server-authoritative
combat, progression persistence, the game screen and the PixiJS combat scene —
is IMPLEMENTED in Phase 3 (ADR-019 and ADR-020). Stage selection and farming
are IMPLEMENTED in Phase 4 PR 4.1 (ADR-021). Online auto-battle, a client
loop over the same combat request, is IMPLEMENTED in Phase 4 PR 4.2
(ADR-022). Server-authoritative offline progression, a lazy
catch-up claimed on return, is IMPLEMENTED in Phase 4 PR 4.3 (ADR-023), and
PR 4.4 supplies its return presentation. The pure item-domain foundation is
IMPLEMENTED in Phase 5 PR 5.1 (ADR-024). Domain events, CQRS infrastructure
and leaderboards are PLANNED.

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
format (`stageNumberSchema`, a canonical decimal string — ADR-018), the player
contracts (`PlayerStateResponse`, `ProvisionPlayerRequest`,
`CharacterResponse`), and — Phase 3 — the HugeNumber wire format
(`hugeNumberSchema`, delegating to Game Core's `HugeNumber.isCanonical` as
ADR-013 approved), the derived `progression` block and the combat contract
(`CombatResponse`, `IDEMPOTENCY_KEY_HEADER`). Phase 4 PR 4.1 added the stage
mode (`stageModeSchema`, `progression.stageMode`) and the stage-selection
contract (`StageSelectionRequest`, `StageSelectionResponse`).

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
`ProgressBar` (Phase 3), `Skeleton`, `StatusBadge` and `TextField` primitives. Further components are created by the feature that
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

Status: IMPLEMENTED (Phase 4 PR 4.3, ADR-023) as a lazy claim on return;
see "Phase 4 PR 4.3 implementation status".

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

As of Phase 2 — Phase 3 has since implemented gameplay persistence, level-up
and the combat UI; see "Phase 3 implementation status". Still open: rate
limiting, account deletion, email change and password reset screens,
display-name uniqueness, and a production host for the API (ADR-012 remains
open).

---

# Phase 3 implementation status

Status: IMPLEMENTED — awaiting CI and user approval. Decisions: ADR-019 (the
server-authoritative combat transaction) and ADR-020 (the stage progression
model: current stage and records).

## Request flow

```
Browser (React)
  │  Fight tapped → one idempotency key per intent (reused on every retry)
  │
  ├─> Supabase Auth ── access token (JWT)
  │
  │  POST /player/characters/:characterId/combats
  │  Authorization: Bearer <token>      Idempotency-Key: <uuid>      (no body)
  v
apps/api
  AuthGuard ── verified identity (ADR-016)
  CombatController (thin: validate path + header, call use case, map result)
  RunCombatUseCase
    1. CombatRepository.loadTarget(authUserId, characterId, key)
         owned character + version + any combat already under the key
    2. key already used → replay: resolveStageAttempt(stored inputs) == stored summary
    3. server clock < next_combat_at → 409 COMBAT_NOT_READY (Retry-After)
    4. no enemy describable on the current stage → 409 STAGE_NOT_PLAYABLE
    5. CombatSeedSource → 256-bit CSPRNG seed
    6. Game Core resolveStageAttempt({ progress, seed, GAME_RULES_VERSION })
         enemy, combat, rewards, level-up, advanceStageProgress — every rule
    7. CombatRepository.commit — one transaction:
         UPDATE characters … WHERE id AND version = expected AND owner
         INSERT combat_runs (unique character_id + idempotency_key)
       conflict → re-read key: replay the winner, or 409
  PrismaCombatRepository ──> PostgreSQL (characters, combat_runs; RLS)
  │
  │  201 CombatResponse (200 on replay): combat timeline, rewards,
  │  before/after, character, progression (currentStage, highestStageReached,
  │  highestStageCleared, next encounter, nextCombatAt)
  v
Browser
  shared Zod contract validates the response
  TanStack Query: authoritative state written into the player-state cache
  GameScreen plays the server's events in real time
     ├─ DOM (React): HUD, health bars, boss marker, aria-live report
     └─ CombatScene adapter ──> PixiJS (animation only)
```

## Module layout

```
packages/game-core/src/progression/   level rule, StageProgress + advanceStageProgress,
                                      resolveStageAttempt, describeProgress
apps/api/src/combat/
  domain/            CombatRun record, replay check
  application/       RunCombatUseCase, CombatRepository and CombatSeedSource ports
  infrastructure/    PrismaCombatRepository, CryptoCombatSeedSource
  presentation/      CombatController, domain → contract mapping
apps/api/src/player/domain/progression-view.ts   derived view for player state
apps/web/src/game/
  combat-api.ts, combat-session.ts, use-combat-session.ts   API + state machine
  playback/          server events → presentation timeline (pure)
  format/            HugeNumber display and bar ratios (presentation only)
  scene/             CombatScene interface, lifecycle hook, lazy Pixi loader
  scene/pixi/        the PixiJS implementation and its look table
  components/        GameScreen, GameHud, CombatStage, CombatReport
```

## Boundaries enforced by tooling

- Game Core purity: unchanged guard test and ESLint rules.
- `apps/web` may import only `HugeNumber` from Game Core (ESLint
  `no-restricted-imports` with `allowImportNames`). Every gameplay rule stays
  on the server (ADR-003, ADR-013).
- PixiJS is imported only by `src/game/scene/pixi/`, and only dynamically.
- `apps/web` refuses to build with a privileged `NEXT_PUBLIC_` variable, and on
  Vercel without its public configuration (docs/DEPLOYMENT.md).

## Stage progression (ADR-020)

```
StageProgress { current, highestReached, highestCleared | null }   (Game Core)
   invariants: current ≤ highestReached, highestCleared ≤ highestReached
   advanceStageProgress: WIN → clear current, move to current + 1
                         LOSS → fall back stagesLostOnDefeat; records kept
        │
        ├─ PostgreSQL: characters.current_stage / highest_stage_reached /
        │              highest_stage_cleared (+ CHECKs); combat_runs.stage is
        │              the stage fought, with the records before it
        ├─ Contract:   progression.{currentStage, highestStageReached,
        │              highestStageCleared}, canonical strings, null allowed
        └─ Web:        HUD shows the current stage and "Best" (highest cleared)
```

Each layer enforces the invariants itself: Game Core by `createStageProgress`,
the database by CHECK constraints, and the contract by an exact `BigInt`
refinement. None of them repairs a bad value. The records are the attachment
point for stage selection and farming (FUTURE), offline progression (Phase 4)
and the Highest Stage ranking (Phase 10, on `highestStageCleared`).

## NOT IMPLEMENTED

Offline progression (Phase 4 attaches at `next_combat_at` and the version
check, ADR-019 §10), the generic idempotency table, rate limiting beyond the
per-character pacing gate, combat history endpoints, auto-battle, and a
production host for the API (ADR-012, owner decision — docs/DEPLOYMENT.md).

---

# Phase 4 PR 4.1 implementation status — stage selection and farming

Status: IMPLEMENTED — awaiting review. Decision: ADR-021 (proposed).

## Request flow

```
Browser (StageSelector)
  │  PUT /player/characters/:characterId/stage-selection
  │  { "mode": "FARM", "stage": "42" }  or  { "mode": "PROGRESS" }
  v
apps/api
  AuthGuard ── verified identity (ADR-016)
  StageSelectionController (thin: strict shared Zod schema, StageNumber.parse)
  SelectStageUseCase
    1. StageSelectionRepository.loadOwnedCharacter(authUserId, characterId)
    2. Game Core selectStage(stages, selection)   ── STAGE_LOCKED → 409
    3. unchanged → no write
    4. saveSelection: UPDATE characters SET current_stage, stage_mode,
         version = version + 1 WHERE id AND version AND owner RETURNING *
       conflict → re-read and re-validate (≤ 3 attempts) → 409 CONCURRENT_UPDATE
  │
  │  200 { character, progression (with stageMode), serverTime }
  v
Browser — writes the authoritative state into the player-state cache
```

The combat flow of Phase 3 is unchanged except that `RunCombatUseCase` passes
the persisted `stageMode` to `resolveStageAttempt` and records it on
`combat_runs`; a replay resolves under the recorded mode.

## Module layout

```
packages/game-core/src/progression/stage-progress.ts   StageMode, selectStage,
                                                        advanceStageProgress(mode)
apps/api/src/player/
  application/select-stage.use-case.ts
  application/ports/stage-selection-repository.port.ts
  infrastructure/prisma-stage-selection.repository.ts
  presentation/stage-selection.controller.ts
packages/contracts/src/game/stage-selection.contract.ts
apps/web/src/game/stage-selection/   API call, mutation hook, pure draft helpers
apps/web/src/game/components/stage-selector.tsx
```

## Concurrency

Selection and combat share `characters.version`. Whichever commits first
wins; the other's conditional write matches no row. A losing combat writes
nothing (and answers `409`); a losing selection re-validates against the
fresh row. No lock is held across a simulation and nothing is process-local.

## NOT IMPLEMENTED

Auto-battle (since implemented, PR 4.2 below), offline progression,
background combat and worker gameplay jobs (Phase 4 PR 4.2+).

---

# Phase 4 PR 4.2 implementation status — online auto-battle

Status: IMPLEMENTED — awaiting review. Decision: ADR-022 (proposed).

**Online auto-battle is not offline progression.** It exists only while a
client is open, visible and sending requests. The server has no auto-battle
state, endpoint, contract, table, worker job or loop; it cannot tell a fight
sent by the loop from one sent by a tap.

## Request flow

```
Browser (visible tab)
  useAutoBattle ── intent: off | running | stopping | halted   (memory only)
     │ nextAutoBattleStep(intent, screen) → wait(why) | fight at T
     │   T = server nextCombatAt (anchored to serverTime) after the result is shown
     │ one setTimeout(T) ── replaced on every change, cleared on unmount
     v
  useCombatSession.fight()   ← the same function as the Fight button
     │ one request in flight at most; fresh key per fight, same key per retry
     v
  POST /player/characters/:id/combats      (ADR-019, unchanged)
     ├─ 201/200 → shown → next step
     ├─ 409 COMBAT_NOT_READY → re-read player state → new gate, new key
     ├─ network / 5xx / 429  → same key, backoff 2–30 s, halt after 5
     └─ 401 / 403 / 404 / STAGE_NOT_PLAYABLE → halt with reason
```

Throughput per character is bounded by the pacing gate on the server, not by
the loop: several tabs, devices or a script share one timeline, and the
losers receive `409`.

## Module layout

```
apps/web/src/game/auto-battle/auto-battle.ts       reducer + step function (pure)
apps/web/src/game/auto-battle/use-auto-battle.ts   the timer, visibility, stop on sign-out
apps/web/src/game/use-page-visible.ts              Page Visibility API
apps/web/src/game/components/battle-controls.tsx   Fight / Auto battle / Stop, status line
apps/api/src/combat/application/run-combat.use-case.ts   structured log events
```

## NOT IMPLEMENTED

Offline progression and its claim (PR 4.3), cross-tab coordination, general
request rate limiting, auto-battle in a hidden tab, and auto-battle that
survives a reload.

---

# Phase 4 PR 4.3 implementation status — offline progression

Status: IMPLEMENTED — awaiting review. Decision: ADR-023 (proposed).

## Request flow

```
Browser (game entry, or the page visible again after being hidden)
  │  POST /player/characters/:characterId/offline-progress
  │  Authorization: Bearer <token>     Idempotency-Key: <uuid>     (no body)
  v
apps/api
  AuthGuard ── verified identity (ADR-016)
  OfflineProgressController (thin: path + header, map result; body ignored)
  ClaimOfflineProgressUseCase
    1. OfflineProgressRepository.loadClaimTarget(authUserId, characterId, key)
         owned character + version + offline seed + claim already under the key
    2. key already used → replay from the stored summary (no re-simulation)
    3. elapsed = max(0, Clock.now − next_combat_at)          ── server time only
    4. Game Core resolveOfflineProgress({ progress, elapsed, offline seed, GAME_RULES_VERSION })
         cap 8 h, minimum 1 min, farm min(current, highestCleared),
         fights back to back through the ordinary combat/reward/level rules,
         ≤ 30 000 fights (LIMIT_EXCEEDED otherwise)
    5. no fight → 200, nothing written
    6. commitClaim — one transaction:
         UPDATE characters SET level, experience, gold, next_combat_at = processedUntil,
                offline_seed = <fresh CSPRNG>, version + 1
          WHERE id AND version = expected AND owner        (no stage column)
         INSERT offline_runs (unique character_id + idempotency_key)
       conflict → re-read and re-resolve (≤ 3) → replay / nothing / 409 CONCURRENT_UPDATE
  PrismaOfflineProgressRepository ──> PostgreSQL (characters, offline_runs; RLS)
  │
  │  201 OfflineProgressResponse (200 on replay or nothing to collect)
  v
Browser — writes the authoritative character into the player-state cache,
          shows a minimal summary, then fights/auto-battle may continue
```

## The time line (ADR-023 §3)

`characters.next_combat_at` is the processed boundary: every instant before
it is accounted for by a fight, online or offline. Online combat moves it to
the combat's end (unchanged); a claim moves it to the end of its last offline
fight (≤ now). No second timestamp exists. An interval is paid at most once
because the boundary only moves forward inside the version-conditional
write that pays for it.

## Module layout

```
packages/game-core/src/offline/offline-progress.ts   resolveOfflineProgress, offlineFarmStage,
                                                      MAX_OFFLINE_FIGHTS
packages/game-core/src/rules/v1.ts                   offline: { capMs, minimumAbsenceMs }
apps/api/src/offline/
  domain/            OfflineRun record, verifyOfflineRun (audit replay)
  application/       ClaimOfflineProgressUseCase, repository and seed-source ports
  infrastructure/    PrismaOfflineProgressRepository
  presentation/      OfflineProgressController, mapper
apps/api/src/common/http/idempotency-key.ts          shared header parsing (combat + offline)
packages/contracts/src/game/offline-progress.contract.ts
apps/web/src/game/offline/                           API call, pure claim state, hook
apps/web/src/game/components/offline-summary.tsx
```

## Not involved

`apps/worker`, Redis and BullMQ: unchanged. No timer, scheduler or loop runs
for an absent player.

## NOT IMPLEMENTED

Offline climbing, an offline efficiency factor (owner decision), general request rate limiting,
the generic idempotency table, and chunked or worker-side resolution of very
large claims.

---

# Phase 5 PR 5.1 implementation status — item domain foundation

Status: IMPLEMENTED. Decision: ADR-024 (proposed).

`packages/game-core/src/items` owns a pure item model. Stable
`ItemDefinitionId` values identify immutable static definitions; canonical
UUID `ItemInstanceId` values identify individual owned items but are supplied
by an outer boundary. An `ItemInstance` stores only its identity, definition
identity and instance rarity. Its slot and content name key are resolved from
the catalog, preventing duplicated or contradictory source state.

The catalog validates and freezes seven representative definitions, preserves
declaration order for deterministic auditing, rejects duplicate IDs, and keeps
its private `Map` behind constant-time lookup methods. Slot and rarity use
uppercase canonical strings. Rarity rank is one explicit table rather than
lexical or enum ordering.

This foundation does not modify `RULES_V1` or `GAME_RULES_VERSION`; it is not
an input to combat and changes no historical simulation. It has no database,
contract, API or web dependency. Future persistence maps canonical strings at
the infrastructure boundary. Future inventory/equipment code must resolve the
definition to determine the legal slot, and future drop code must supply an
outer-boundary instance ID and validated rarity. Phase 6 may add rolled source
state to `ItemInstance` additively after defining its own typed model; no
untyped placeholder is present.

## Inventory and equipment persistence — COMPLETE / APPROVED (Phase 5 PR 5.2)

ADR-025 adds an authenticated API/application/repository path for character-owned item instances. PostgreSQL stores normalized ownership and one equipment row per character/slot; the API derives slots through the Game Core catalog and serializes mutations with all other character writes through `characters.version`. Equipment has no combat effect in this phase.

# Phase 5 PR 5.3 implementation status — combat item drops

Online combat resolves optional loot in pure Game Core under rules v2 from an independent seed derived as `deriveSeed(combatSeed, "item-drop", rulesVersion, stage)`. Combat RNG and rules-v1 fingerprints are unchanged. The combat repository atomically updates progression, inserts `combat_runs`, and inserts the optional `item_instances` row. A unique nullable reward FK ties zero or one instance to the combat idempotency identity. Retry loads and returns that same row. Auto Battle inherits this path; offline item drops are explicitly deferred because offline claims are aggregated. See ADR-026.

## Phase 5 PR 5.4 implementation status — web gear presentation

`apps/web/src/gear` is the presentation integration for the existing inventory
and equipment contracts. TanStack Query owns separate user/character-scoped
inventory and equipment keys. Inventory remains the server's full owned set;
the view subtracts equipped IDs, deduplicates by instance ID and sorts by the
canonical rarity rank. Mutations send only item instance ID or slot, apply the
authoritative equipment response, then refresh owned state. Combat rewards
deduplicate by instance ID and invalidate inventory. No browser gameplay rule
or direct Supabase data mutation is introduced.

## Phase 6 PR 6.1 implementation status — character stats foundation

`packages/game-core/src/character-stats` owns the pure pipeline from
authoritative progression inputs to base stats and from base stats plus a
modifier multiset to resolved character stats. The initial identifiers are
`MAX_HEALTH`, `DAMAGE`, `ATTACK_SPEED`, `CRITICAL_CHANCE` and
`CRITICAL_DAMAGE`: exactly the values current player combat consumes. Armor is
not introduced because the current engine has no mitigation mechanic.

Health and damage use `HugeNumber`. Rates use safe-integer basis points
(10,000 = 100%; for attack speed, 10,000 = one attack per second). Modifier
resolution is `BASE -> FLAT -> ADDITIVE_PERCENT -> CLAMP`. Modifier input is
canonically sorted by stat, operation, source type, source ID and value, rather
than trusting query or insertion order. Percentage terms are summed exactly as
`bigint`; integer rate division and `HugeNumber` both use half-to-even
rounding. Final minima are one health, zero damage, one attack-speed point,
zero critical chance and 100% critical damage; critical chance is capped at
100%. Combat's existing versioned attack-speed cap remains a combat rule.

`deriveBaseCharacterStats(level, rules)` makes the applicable immutable rules
version explicit and has no ambient dependency. Modifiers retain source type
and ID for diagnostics and future breakdowns, but resolution never branches on
their origin. This lets affixes, equipment, skills, buffs, debuffs and passives
produce the same `StatModifier[]` without coupling Combat to those systems.

PR 6.1 creates no persistence or transport contract. Equipment produces no
modifiers yet, Combat still receives its existing level-derived `CombatStats`,
and `GAME_RULES_VERSION` remains 2. PR 6.2 will define item power/affix source
state; PR 6.3 will snapshot resolved equipment stats into combat; PR 6.4 will
present the breakdown. See ADR-027.

## Item power snapshots (Phase 6 PR 6.2 — IN PROGRESS)

Static `ItemDefinition` and `AffixDefinition` catalogs live in pure Game Core. An owned `ItemInstance` records its item-generation version and normalized, ordered rolled-affix snapshots; APIs eagerly load those rows and never reroll on read. Generation uses a dedicated seed derived after loot identity/rarity selection, and instance plus rolls commit inside the combat reward transaction. Rolled items convert to the canonical ADR-027 `StatModifier[]`, but production combat deliberately does not consume those modifiers until PR 6.3. See ADR-028.
