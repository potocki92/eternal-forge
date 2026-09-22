# ADR-012 — Deployment topology

## Status

Partially accepted — the API and worker hosting decision is open.

## Date

2026-09-22

## Context

`docs/ARCHITECTURE.md` names Vercel, Supabase and a Redis provider as the
initial targets, and Phase 0's task list includes deploying the web application
to Vercel.

The three workloads have genuinely different runtime shapes:

- `apps/web` is a Next.js application — exactly what Vercel is built for.
- `apps/api` is a long-lived NestJS process holding a PostgreSQL pool and a
  Redis connection. Serverless invocations are a poor fit: connection pools do
  not survive them well, and per-invocation database connections are hostile to
  a pooled PostgreSQL.
- `apps/worker` is a persistent BullMQ consumer. It has no request to be
  triggered by and must simply keep running.

## Decision

**Decided:**

- `apps/web` deploys to Vercel. The repository root is a monorepo, so the
  project's root directory is `apps/web` and the install/build commands run
  through pnpm and Turborepo.
- PostgreSQL and authentication are provided by Supabase.
- Redis comes from a managed provider; the choice of provider is an operational
  decision, not an architectural one, because nothing depends on a
  provider-specific feature.
- `apps/web` exposes its own liveness endpoint at `/api/health`, independent of
  the API. A platform health check must report on the deployment it is checking.
- `apps/api` exposes `/health` (liveness, no dependency checks) and
  `/health/ready` (readiness, 503 when a dependency is unreachable), so a load
  balancer can drain a node without an orchestrator restarting a healthy
  process because a cache blipped.

**Open:**

The hosting platform for `apps/api` and `apps/worker` is not decided. Both are
long-running processes and need a container or always-on runtime. The decision
is deferred to Phase 2, when authentication makes the API load-bearing, and will
be recorded as a superseding ADR.

Until then the API and worker are run locally or from `docker-compose.yml`, and
nothing in the code assumes a specific host: configuration arrives through
environment variables (ADR-010) and both processes shut down cleanly on
`SIGTERM`.

## Consequences

- The web application can be deployed and previewed immediately, independently
  of the backend.
- Phase 0 ships no production API deployment. The status page reports the API as
  unreachable until one exists — which is accurate, and is asserted by an
  end-to-end test.
- Because the API host is undecided, no provider-specific runtime API may be
  used in `apps/api` or `apps/worker`.

## Alternatives Considered

**Everything on Vercel, API as serverless functions.** Rejected for now: poor
fit for a pooled database connection and impossible for a persistent queue
consumer.

**Everything on one container host, including web.** Viable and kept open, but
it gives up Vercel's preview deployments and edge delivery for the one workload
that genuinely benefits from them.

**Deciding the API host now.** Rejected: there is no API worth deploying until
Phase 2, and the cost of choosing later is a single ADR.
