# Eternal Forge — Software Architecture

Status: PARTIALLY IMPLEMENTED (Phase 0) / EVOLVING

The architectural style, boundaries and package layout described here are
IMPLEMENTED as of Phase 0. Everything gameplay-related — Game Core simulation,
domain events, CQRS, offline processing, leaderboards — is PLANNED.

See "Phase 0 implementation status" at the end of this document for exactly what
exists today, and `docs/adr/` for the decisions behind it.

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

---

# packages/contracts

Contains transport contracts shared between client/server.

Use Zod where appropriate.

Examples:

PlayerStateResponse
InventoryResponse
CombatResponse
LeaderboardResponse

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

Status: IMPLEMENTED as infrastructure. The Prisma schema declares no models yet;
tables arrive with the phase that needs them. See ADR-011.

---

# packages/ui

Reusable application UI.

Does not contain core gameplay rules.

Status: IMPLEMENTED — design tokens plus the `Button`, `Panel` and
`StatusBadge` primitives. Further components are created by the feature that
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

---

# Rules version

Consider associating important deterministic simulations with a game rules
version.

Reason:

a replay created before a balance patch may otherwise produce a different
result after formulas change.

Exact implementation should remain simple until needed.

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

## NOT IMPLEMENTED

Everything gameplay-related. Specifically, and deliberately: HugeNumber, RNG,
combat, stages, rewards, items, effects, skills, passives, prestige, offline
progression, leaderboards, guilds, arena, seasons, authentication, persistence
of player state, domain events, CQRS infrastructure, rate limiting and PixiJS.

## Open architectural decisions

- Hosting for `apps/api` and `apps/worker` (ADR-012, deferred to Phase 2).
- `HugeNumber` representation, persistence format and leaderboard ordering key
  (ADR-013, required before Phase 1 completes).
