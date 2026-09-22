# ADR-006 — Redis for ephemeral state, never as the source of truth

## Status

Accepted

## Date

2026-09-22

## Context

Several planned features are a poor fit for PostgreSQL alone: live leaderboards
with rank-and-neighbours queries, per-endpoint rate limiting, locks around
economy operations, short-lived caches, and a job queue for offline processing,
season rollovers and world events.

Redis serves all of these well. It is also, in practice, the component teams
most often start treating as a database — at which point an eviction or a lost
node silently destroys player progress.

## Decision

Redis is used for caching, active leaderboards, distributed locks, rate limiting,
ephemeral state and as the BullMQ transport. It is never the persistent record
of anything a player can lose.

- Any leaderboard served from Redis is derivable from PostgreSQL. Persistent
  snapshots and history live in PostgreSQL.
- A flushed or cold Redis must degrade the product — slower queries, a rebuilt
  cache — never corrupt it.
- Each process owns its own connection, configured for its access pattern.
  `apps/api` fails commands fast while disconnected so a probe reports an
  outage; the BullMQ connection uses `maxRetriesPerRequest: null`, because any
  other value breaks BullMQ's blocking reads during a reconnect.

## Consequences

- Leaderboard reads are fast without denormalising ranking into the primary
  database's hot path.
- Every Redis-backed structure needs a defined rebuild path from PostgreSQL.
  That is additional work, and it is what makes a Redis outage survivable.
- A Redis outage degrades readiness rather than preventing startup, so the API
  can still serve endpoints that do not need it.

## Alternatives Considered

**PostgreSQL only.** Rejected: workable for ranking at small scale, but rate
limiting, locks and a job queue in the primary database put avoidable write load
on the system that must never be the bottleneck for an economy transaction.

**Redis as the primary store for live progression.** Rejected: no relational
integrity, and durability guarantees that do not match "the player's account".

**A managed queue service instead of BullMQ.** Rejected for now: Redis is
already a dependency, BullMQ is TypeScript-native, and a separate provider adds
an operational surface for no capability the project currently needs.
