# ADR-001 — Modular monolith over microservices

## Status

Accepted

## Date

2026-09-22

## Context

Eternal Forge is a long-lived idle RPG with many planned subsystems: combat,
items, skills, passives, prestige, guilds, arena, seasons and rankings. Those
subsystems share a single player identity and a single economy, and most
gameplay writes touch several of them within one transaction.

The project starts with one developer and no measured traffic. A distributed
topology would immediately impose service discovery, network failure handling,
cross-service transactions and per-service deployment before a single gameplay
rule exists.

At the same time, the subsystem list is long enough that an undisciplined
single codebase would collapse into mutual dependencies within a few phases.

## Decision

The backend is a **modular monolith** arranged by domain module, each module
internally layered as Domain → Application → Infrastructure → Presentation
(Clean/Hexagonal, DDD-lite).

- Modules communicate through application services and domain events, not by
  reaching into one another's internals.
- Domain never depends on Infrastructure. Application depends on ports;
  Infrastructure implements them.
- A module is extracted into a separate service only when a measured
  requirement — not a hypothetical one — justifies the operational cost.

Background work runs in a separate process (`apps/worker`) because its runtime
profile genuinely differs from request handling, not because it is a separate
"service" in the distributed sense. It shares the same packages and database.

## Consequences

- One deployable API, one database, ordinary local transactions. Economy
  operations spanning several modules stay atomic without distributed
  coordination.
- Module boundaries must be enforced by discipline and by tooling (lint rules,
  package boundaries) rather than by the network.
- Scaling is vertical plus stateless API replicas. That is sufficient for the
  foreseeable load profile of an idle game, where write volume per player is low.
- If a module ever does need extraction, the port/adapter boundaries make the
  seam explicit; the cost is deferred, not paid twice.

## Alternatives Considered

**Microservices from the start.** Rejected: it buys independent scaling and
deployment the project cannot yet use, at the price of distributed transactions
across an economy that must never leave partial state.

**Unstructured monolith.** Rejected: fastest initially, but the planned system
count guarantees a tangle of cross-imports, which is precisely the failure this
project has to survive for years.

**Serverless functions per endpoint.** Rejected: a deterministic simulation
engine and a long-running queue worker fit poorly into short-lived, stateless
invocations, and per-invocation database connections are hostile to a pooled
PostgreSQL.
