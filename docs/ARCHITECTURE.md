# Eternal Forge — Software Architecture

Status: PLANNED / EVOLVING

---

# Architectural style

Eternal Forge uses:

Modular Monolith
+
Clean / Hexagonal Architecture
+
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
|                |
v                v
Application      Redis
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

Contains database infrastructure.

Possible responsibilities:

Prisma schema
Prisma client
migration helpers
database-related infrastructure.

Do not leak Prisma types into Domain.

---

# packages/ui

Reusable application UI.

Does not contain core gameplay rules.

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
|    -> web
|    -> compatible application services where appropriate
|
+-> Supabase
|    -> PostgreSQL
|    -> Auth
|    -> Storage
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
