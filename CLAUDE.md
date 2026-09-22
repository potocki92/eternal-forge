# Eternal Forge — Claude Development Instructions

## Project

Eternal Forge is a long-term browser-based idle RPG with deep character
progression, theorycrafting, rankings, competition, equipment, skills,
prestige systems and effectively unlimited progression.

This is intended to become a production-quality application.

Do NOT treat this project as:
- a prototype,
- hackathon code,
- disposable MVP,
- simple clicker game.

The architecture must support years of development.

---

# Required reading

Before making changes, read the documentation relevant to the task.

Core documentation:

@docs/MASTER_PLAN.md
@docs/ARCHITECTURE.md
@docs/GAME_DESIGN.md
@docs/DATABASE.md
@docs/ROADMAP.md
@docs/SECURITY.md
@docs/UI_SYSTEM.md

For architectural decisions also inspect:

@docs/adr/

Documentation is part of the project.

Code and documentation must remain synchronized.

---

# Development philosophy

Priority order:

1. Correctness
2. Maintainability
3. Testability
4. Security
5. Clear architecture
6. Performance
7. Developer experience
8. Implementation speed

Never sacrifice architecture merely to finish a feature faster.

Avoid overengineering systems that do not yet require it.

---

# Architecture

The project uses:

- Modular Monolith
- Clean / Hexagonal Architecture
- DDD-lite
- server-authoritative gameplay
- deterministic Game Core
- data-driven game content

Do NOT introduce microservices unless explicitly approved.

Do NOT introduce full Event Sourcing unless explicitly approved.

---

# Technology

Primary stack:

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- Zod
- PixiJS

Backend:
- NestJS
- TypeScript

Game Engine:
- pure TypeScript

Database:
- PostgreSQL
- Supabase

ORM:
- Prisma

Infrastructure:
- Redis
- BullMQ

Testing:
- Vitest
- Playwright

Repository:
- GitHub

Deployment:
- Vercel where appropriate
- Supabase for PostgreSQL/Auth/Storage
- Redis provider selected by infrastructure requirements

Package manager:
- pnpm

Monorepo:
- Turborepo

Do not silently replace major technologies.

Major technology changes require:
1. analysis,
2. ADR,
3. explicit user approval.

---

# Repository structure

Expected high-level structure:

apps/
  web/
  api/
  worker/

packages/
  game-core/
  contracts/
  database/
  ui/
  config/
  eslint-config/
  typescript-config/

docs/
  adr/

---

# Game Core

packages/game-core is the most important package.

It must remain framework-independent.

game-core MUST NOT depend on:

- React
- Next.js
- NestJS
- Prisma
- Supabase
- Redis
- BullMQ
- PixiJS
- HTTP libraries
- database libraries

Game Core contains gameplay rules and calculations.

Examples:

- combat
- stats
- damage
- critical hits
- attack speed
- RNG
- enemies
- stage scaling
- loot calculations
- progression
- effects
- prestige calculations
- offline simulation
- HugeNumber

Game Core must be testable without:
- database,
- network,
- browser,
- framework.

---

# Server authority

The server is authoritative.

The client must NEVER decide:

- damage,
- rewards,
- XP,
- gold,
- item drops,
- crafting results,
- upgrade results,
- PvP results,
- leaderboard values,
- prestige rewards.

The client presents state.

The server validates and changes state.

Never trust gameplay values supplied by the client.

---

# Determinism

Combat and important simulations should be deterministic whenever practical.

Same:

input + seed + rules version

must produce the same result.

Never use Math.random() directly inside domain gameplay logic.

Use the project's RNG abstraction.

---

# Huge numbers

Do not assume JavaScript Number is sufficient for gameplay.

Use the shared HugeNumber abstraction for values that can scale beyond safe
numeric limits.

Do not create alternative implementations of large-number arithmetic in
individual modules.

---

# Data-driven design

Game content must be data-driven wherever practical.

Never write logic such as:

if (weapon.name === "DemonSword") {
  damage *= 1.5;
}

Prefer:

definition
+
effects
+
generic engine.

New content should normally be possible without modifying the fundamental
combat engine.

---

# Domain boundaries

Domain must not depend on Infrastructure.

Application may depend on Domain.

Infrastructure implements required ports.

Presentation communicates with Application.

Forbidden:

Controller -> Prisma directly

Forbidden:

React component -> gameplay business logic

Forbidden:

Game Core -> infrastructure

---

# Controllers

Controllers must be thin.

They:
- validate transport input,
- call application use cases,
- translate application results.

They must not contain gameplay/business rules.

---

# Persistence

Do not treat Prisma models as domain entities.

Separate:

- Domain Entity
- Persistence Model
- API Contract

Use repositories/ports to separate persistence from domain logic.

---

# Shared contracts

packages/contracts contains shared API contracts.

Use Zod where appropriate.

Do not independently create slightly different frontend and backend versions
of the same API contract.

---

# Economy

Important economy operations must eventually be:

- server-authoritative,
- transactional,
- idempotent,
- auditable.

Never modify several economically important resources through unrelated,
unsafe operations.

---

# Redis

PostgreSQL remains the persistent source of truth unless an architecture
decision explicitly states otherwise.

Redis may be used for:

- caching,
- active leaderboards,
- locks,
- rate limiting,
- ephemeral state,
- BullMQ.

---

# Frontend state

Use:

TanStack Query:
server state

React state:
small local UI state

Zustand:
only when shared client state genuinely requires it

Do not mirror the entire backend state into a global Zustand store.

---

# UI

Mobile-first.

Primary design viewport:

390x844.

Every important feature must work well on:
- phone,
- tablet,
- desktop.

Do not create separate mobile and desktop components without a real reason.

Prefer responsive composition.

---

# PixiJS

PixiJS is intended primarily for game rendering such as CombatScene.

Do not build:
- forms,
- inventory,
- rankings,
- settings,
- ordinary navigation

inside PixiJS.

React owns application UI.

PixiJS visualizes gameplay.

PixiJS must never become gameplay truth.

---

# Reusability

Before creating a component:

1. search for an existing component,
2. check whether it can be extended,
3. prefer composition,
4. create a new component only when necessary.

Avoid components such as:

RedButton
BlueButton
InventoryButton
UpgradeButton

when a generic Button with variants is sufficient.

---

# TypeScript

Use strict TypeScript.

Avoid `any`.

If `any` is genuinely unavoidable:
- document why,
- limit its scope.

Do not use `as` merely to silence a type error.

Fix the underlying model when possible.

---

# Testing

Gameplay changes require tests.

Priority:

1. Game Core unit tests
2. Domain/application tests
3. Repository integration tests
4. API integration tests
5. Playwright E2E

A gameplay bug should receive a regression test whenever practical.

Never remove a valid test simply to make CI pass.

---

# Security

Never:
- commit secrets,
- log passwords,
- log access tokens,
- trust playerId from request body,
- trust gameplay values from the client.

Identity must originate from authenticated server context.

Validate all external input.

---

# Documentation

Documentation is mandatory.

Update documentation when:
- architecture changes,
- domain rules change,
- database architecture changes,
- major gameplay mechanics change,
- roadmap state changes.

Do not describe planned features as implemented.

Use labels:

IMPLEMENTED
IN PROGRESS
PLANNED
FUTURE

---

# ADR

Important architectural decisions require an ADR.

Format:

Context
Decision
Consequences
Alternatives Considered

Never rewrite architectural history silently.

---

# Workflow

Before implementing a task:

1. Inspect repository.
2. Read relevant documentation.
3. Locate existing implementation.
4. Check existing tests.
5. Determine affected domains.
6. Plan the smallest coherent change.
7. Implement.
8. Add/update tests.
9. Run lint.
10. Run typecheck.
11. Run tests.
12. Run build.
13. Perform self-review.
14. Update documentation.

---

# Roadmap rule

Work on ONE roadmap phase at a time.

Never automatically start the next phase.

When a phase is complete:
- update ROADMAP.md,
- produce a completion report,
- STOP.

Wait for explicit user approval before beginning the next phase.

---

# Definition of Done

A feature is not complete merely because it appears to work.

Done means:

- implementation complete,
- architecture respected,
- no known TypeScript errors,
- lint passes,
- relevant tests pass,
- build passes,
- documentation updated,
- no accidental dead code,
- no unexplained TODO placeholders,
- self-review completed.

---

# Current development state

Always check:

@docs/ROADMAP.md

before deciding what should be implemented next.
