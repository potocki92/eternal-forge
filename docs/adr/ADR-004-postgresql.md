# ADR-004 — PostgreSQL as the source of truth

## Status

Accepted

## Date

2026-09-22

## Context

Player state in Eternal Forge is highly relational: a character owns item
instances, each item instance references a definition and carries generated
affixes and sockets; progression, resources, prestige and guild membership all
hang off the same identity. Economy operations must be atomic and auditable.

A common shortcut in idle games is to store the whole player as one JSON
document. That makes early development fast and makes every later requirement —
"rank players by boss damage", "find every item with this affix", "audit where
this gold came from" — a full-table scan over documents with no integrity
guarantees.

## Decision

PostgreSQL is the persistent source of truth, accessed through Prisma, hosted on
Supabase.

- Important persistent entities are modelled relationally, with foreign keys,
  unique constraints and non-negative checks where they are valid. Application
  validation does not replace database integrity.
- JSONB is used where the data is genuinely open-ended, not as a way to avoid
  designing a table.
- Every schema change is a migration in the repository. Production schema is
  never edited out of band.
- Tables are created by the phase that needs them. The Phase 0 schema declares
  no models on purpose.
- Prisma models are persistence models. They are mapped to domain entities by
  repositories and are never exposed as domain types or as API contracts.

## Consequences

- Constraints catch invalid state that application bugs would otherwise persist,
  which matters most in the economy.
- Multi-table economy operations are ordinary transactions.
- A schema change requires a migration rather than a code-only edit; this is
  friction by design, because the alternative is undocumented drift.
- Prisma types must be kept out of the domain, which costs explicit mapping code
  in repositories.

## Consequences for large values

Idle-game quantities exceed `bigint` and IEEE-754 precision. The persistence
format for those values is a separate, unresolved decision — see ADR-013.

## Alternatives Considered

**One JSON document per player.** Rejected: no integrity, no partial updates, no
efficient cross-player queries, and concurrent writes degenerate into
last-write-wins over the entire player.

**MongoDB or another document store.** Rejected: the data is relational and the
economy needs multi-entity atomicity; the flexibility on offer is not the
flexibility this project needs.

**Redis as primary storage.** Rejected outright — see ADR-006.

**Raw SQL without an ORM.** Rejected: Prisma's migration history and generated
types are worth more over a multi-year project than the marginal control of
hand-written SQL, and raw SQL remains available where a query needs it.
