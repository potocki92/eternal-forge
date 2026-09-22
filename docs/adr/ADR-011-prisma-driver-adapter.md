# ADR-011 — Prisma 7 with the `pg` driver adapter

## Status

Accepted

## Date

2026-09-22

## Context

Prisma 7 changes how a client obtains its connection. `url` and `directUrl` are
no longer accepted in `schema.prisma`; connection strings for Migrate and
Introspect move to `prisma.config.ts`, and the runtime client is given a **driver
adapter** instead of a connection string.

Separately, Supabase exposes two endpoints: a transaction pooler for runtime and
a direct connection for DDL. Running migrations through the pooler fails.

A third, non-obvious detail: with a custom generator `output` under pnpm, the
generated client's runtime dependency `@prisma/client-runtime-utils` is not
resolvable from the generated directory unless the owning package declares it.

## Decision

- `packages/database` owns the schema, the generated client and the client
  factory.
- `prisma.config.ts` supplies Migrate's connection string, preferring
  `DIRECT_URL` and falling back to `DATABASE_URL`. When neither is set the
  datasource is omitted entirely, so `prisma generate` works on a fresh clone
  and in CI with no database.
- The runtime client is built by `createPrismaClient({ databaseUrl })` using
  `@prisma/adapter-pg`. The URL is injected, never read from `process.env` —
  configuration is the owning application's responsibility (ADR-010).
- `@prisma/client-runtime-utils` is an explicit dependency of
  `packages/database`, so the generated client resolves it under pnpm's
  non-flat `node_modules`.
- Connectivity probing is expressed as a narrow port (`DatabaseProbeTarget`)
  rather than the full client, so readiness checks are testable without a
  generated client or a database.
- `schema.prisma` declares **no models** in Phase 0. Tables arrive with the
  phase that needs them (ADR-004).

## Consequences

- Migrations run against the direct endpoint and runtime traffic through the
  pooler, which is what Supabase requires.
- The pool is configurable per process, so the API and the worker can size
  connections independently.
- `prisma generate` runs as part of `build` and `typecheck` in
  `packages/database`, because the generated client is a compile-time
  dependency of the package's own sources.
- The generated client is CommonJS and is consumed from ESM through Node's
  interop. This was verified to resolve at runtime, not just to typecheck.

## Alternatives Considered

**Pin Prisma 6 to keep `url` in the schema.** Rejected: it defers a mandatory
migration and starts the project on a superseded major.

**Read `DATABASE_URL` inside `createPrismaClient`.** Rejected: it would make
`packages/database` a second source of configuration truth and hide the
dependency from the application that owns the process.

**Default generator output inside `node_modules`.** Not available in Prisma 7,
which requires an explicit `output`.
