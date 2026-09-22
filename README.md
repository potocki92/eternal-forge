# Eternal Forge

A browser-first idle action RPG built for deep character progression,
theorycrafting, competitive rankings and effectively unlimited growth.

> The repository is named `external-forge`; the product is **Eternal Forge**.

**Current phase: Phase 1 — Game Core Foundation** (complete, awaiting
approval). The deterministic, headless simulation exists: `HugeNumber`, a seeded
RNG, versioned rules, combat, stages and rewards. It has no UI, no persistence
and no player accounts yet. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Requirements

- Node.js 22 (`.nvmrc`)
- pnpm 10 (`corepack enable`)
- Docker, for local PostgreSQL and Redis

## Getting started

```bash
corepack enable
pnpm install

cp .env.example .env
docker compose up -d          # PostgreSQL + Redis

pnpm run build
pnpm dev                      # web :3000, api :3001, worker
```

Then open:

- http://localhost:3000 — start page
- http://localhost:3000/status — live readiness of the API and its dependencies
- http://localhost:3001/health — API liveness
- http://localhost:3001/health/ready — API readiness

## Commands

| Command                                         | Description                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                      | Runs every application in watch mode                  |
| `pnpm run build`                                | Builds every package and application                  |
| `pnpm run lint`                                 | ESLint across the workspace                           |
| `pnpm run typecheck`                            | `tsc --noEmit` across the workspace                   |
| `pnpm run test`                                 | Vitest unit and integration suites                    |
| `pnpm run test:e2e`                             | Playwright end-to-end suite                           |
| `pnpm run format`                               | Prettier write                                        |
| `pnpm run verify`                               | format check → lint → typecheck → test → build        |
| `pnpm run db:generate`                          | Regenerates the Prisma client                         |
| `pnpm run db:migrate`                           | Creates and applies a development migration           |
| `pnpm --filter @eternal-forge/worker run smoke` | Enqueues a job and waits for the worker to process it |
| `pnpm --filter @eternal-forge/game-core run simulate -- --level 1 --seed demo` | Headless stage run: `Stage 1 — WIN` … `Stage N — LOSS` |
| `pnpm --filter @eternal-forge/game-core run bench` | HugeNumber and combat benchmarks (not part of `test` or CI) |

`pnpm run verify` is the same gate CI enforces, minus the end-to-end suite,
which needs browsers installed (`pnpm --filter @eternal-forge/web exec playwright
install chromium`). Run `verify` before pushing.

The API and worker load `.env` from the repository root at startup in
development. Variables already present in the environment always win, and the
file is not read at all when `NODE_ENV=production`.

## Repository layout

```
apps/
  web/        Next.js application — React UI, later the PixiJS combat scene
  api/        NestJS HTTP API — the authoritative server
  worker/     BullMQ worker — background and scheduled processing

packages/
  game-core/         Pure, deterministic gameplay rules. No frameworks, no I/O
  contracts/         Zod transport contracts shared by client and server
  database/          Prisma schema and client, Supabase clients
  ui/                Design tokens and reusable UI primitives
  config/            Environment validation, split server/client
  eslint-config/     Shared flat ESLint configurations
  typescript-config/ Shared TypeScript presets

docs/         Architecture, game design, database, security, UI, roadmap
docs/adr/     Architecture Decision Records
```

## Architecture in one page

- **Modular monolith**, Clean/Hexagonal, DDD-lite ([ADR-001](docs/adr/ADR-001-modular-monolith.md)).
- **The server is authoritative.** The client sends intent and presents state;
  it never decides damage, rewards, drops or rankings
  ([ADR-003](docs/adr/ADR-003-server-authoritative.md)).
- **`packages/game-core` is framework-free** and deterministic. Lint rules and a
  guard test enforce it ([ADR-002](docs/adr/ADR-002-game-core.md)). The same
  input, seed and rules version always produce the same result
  ([ADR-005](docs/adr/ADR-005-deterministic-combat.md),
  [ADR-015](docs/adr/ADR-015-rng-rule-sets-combat-timeline.md)).
- **Large numbers are `HugeNumber`**: exact decimal arithmetic with 18
  significant digits, never `float64` for gameplay values
  ([ADR-013](docs/adr/ADR-013-large-number-persistence.md)).
- **PostgreSQL is the source of truth.** Redis is cache, locks, live ladders and
  the queue — never the record of anything a player can lose
  ([ADR-004](docs/adr/ADR-004-postgresql.md), [ADR-006](docs/adr/ADR-006-redis.md)).
- **Contracts are shared.** `packages/contracts` is the single definition of
  every request and response shape.

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then
[`docs/adr/`](docs/adr/README.md).

## Configuration

Every variable is listed in [`.env.example`](.env.example) and validated at
process start by `@eternal-forge/config`. An invalid value fails the boot with a
list of offending variable names — never their values.

Never commit `.env`. The Supabase service-role key bypasses Row Level Security
and must exist only in server-side environments
([`docs/SECURITY.md`](docs/SECURITY.md)).

## Contributing

1. Read [`CLAUDE.md`](CLAUDE.md) and the documents it references.
2. Work on one roadmap phase at a time.
3. Gameplay changes require tests. A gameplay bug gets a regression test.
4. Keep documentation in step with the code; architectural decisions get an ADR.
5. `pnpm run verify` must pass.
