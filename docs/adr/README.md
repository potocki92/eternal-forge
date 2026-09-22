# Architecture Decision Records

Each record captures one decision, the context that forced it, and what the
project accepts as a consequence.

Records are append-only. A decision that no longer holds is superseded by a new
record; it is never edited away (CLAUDE.md — "ADR").

| ADR                                        | Title                                                   | Status             |
| ------------------------------------------ | ------------------------------------------------------- | ------------------ |
| [001](ADR-001-modular-monolith.md)         | Modular monolith over microservices                     | Accepted           |
| [002](ADR-002-game-core.md)                | Framework-independent Game Core package                 | Accepted           |
| [003](ADR-003-server-authoritative.md)     | Server-authoritative gameplay                           | Accepted           |
| [004](ADR-004-postgresql.md)               | PostgreSQL as the source of truth                       | Accepted           |
| [005](ADR-005-deterministic-combat.md)     | Deterministic, seeded simulation                        | Accepted           |
| [006](ADR-006-redis.md)                    | Redis for ephemeral state, never as the source of truth | Accepted           |
| [007](ADR-007-pixijs.md)                   | PixiJS for combat visualisation only                    | Accepted           |
| [008](ADR-008-monorepo-toolchain.md)       | pnpm workspace, Turborepo and the shared toolchain      | Accepted           |
| [009](ADR-009-esm-only-workspace.md)       | ESM-only workspace                                      | Accepted           |
| [010](ADR-010-configuration-boundary.md)   | Validated configuration with a server/client split      | Accepted           |
| [011](ADR-011-prisma-driver-adapter.md)    | Prisma 7 with the `pg` driver adapter                   | Accepted (amended) |
| [012](ADR-012-deployment-topology.md)      | Deployment topology                                     | Partially accepted |
| [013](ADR-013-large-number-persistence.md) | Large-number persistence and ranking order              | Accepted           |
| [014](ADR-014-code-generation-task.md)     | Code generation as an explicit Turborepo task           | Accepted           |
| [015](ADR-015-rng-rule-sets-combat-timeline.md) | Deterministic RNG, versioned rule sets and the combat timeline | Accepted |

## Format

```
# ADR-NNN — Title

Status
Date
Context
Decision
Consequences
Alternatives Considered
```
