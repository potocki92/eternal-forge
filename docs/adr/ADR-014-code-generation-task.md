# ADR-014 — Code generation as an explicit Turborepo task

## Status

Accepted. Amends one consequence of ADR-011.

## Date

2026-09-22

## Context

`packages/database` imports the Prisma client from `generated/prisma`, a
directory that is git-ignored and produced by `prisma generate`. ADR-011 made
generation part of the package's own `build` and `typecheck` scripts.

That left every other task reading the package's sources without the generated
client. The first CI run on `main` failed exactly there:

- On a clean checkout, `turbo run lint` ran `@eternal-forge/database#lint` with
  no `generated/` directory. Type-aware ESLint could not resolve `PrismaClient`,
  so `@typescript-eslint/no-unsafe-call` reported
  `new PrismaClient(...)` as an unsafe construction of an unresolved type.
- Locally the problem was invisible: a previous `build` or `typecheck` had
  already left `generated/` on disk.
- The same gap existed for `test`: `prisma-client.test.ts` imports the module
  that imports the generated client, and passed in CI only because the
  `Typecheck` step happened to run first.
- `database#build` (a dependency of every downstream `lint`) and a concurrently
  scheduled `database#typecheck` both ran `prisma generate` into the same
  directory, a latent race.

The lint rule was right. The task graph was wrong: an ordering that held by
accident of step order, not by declaration.

## Decision

- `db:generate` is a Turborepo task with declared inputs (`prisma/schema.prisma`,
  `prisma.config.ts`, `package.json`) and outputs (`generated/**`).
- `build`, `typecheck`, `lint`, `test` and `dev` depend on the package's own
  `db:generate`. Turborepo skips the dependency in packages that do not define
  the script, so no other package is affected.
- `packages/database`'s `build` and `typecheck` scripts no longer invoke
  generation themselves; the task graph is the single place that orders it.
- Generated code stays out of version control.

## Consequences

- Any task, run alone or in any combination on a clean checkout, sees the
  generated client. Verified by running each of `lint`, `typecheck`, `test` and
  `build` as the first command after `git clean -fdx`, and all four together.
- Generation runs once per invocation instead of once per script, so the race
  is gone.
- `generated/**` is cached and restored by Turborepo like any other output.
  The hash includes the package's resolved external dependencies, so a Prisma
  upgrade regenerates.
- Running a package script directly with `pnpm --filter … run lint` bypasses the
  task graph and does not generate. Use `turbo run` (every root script already
  does) or run `pnpm run db:generate` first.
- The next code generator (for example, generated Supabase database types)
  follows the same pattern instead of chaining commands inside scripts.

## Alternatives Considered

**Disable `no-unsafe-call` or cast `PrismaClient` to `any`.** Rejected: it hides
a real ordering defect and removes type safety from the one place the database
client is constructed.

**Commit the generated client.** Rejected: it is several thousand lines that
must be regenerated on every Prisma or schema change, and a stale committed copy
fails silently rather than loudly.

**Run `prisma generate` in `postinstall`.** Rejected: it couples installation to
code generation, runs on `pnpm install --prod` in deployment images where the
Prisma CLI is a devDependency, and is not cached or invalidated by schema
changes.

**Add a `db:generate` step to the CI workflow.** Rejected: it fixes CI and
leaves every developer's clean checkout, and every future workflow, to rediscover
the ordering.

**Prefix `lint` and `test` scripts with `pnpm run db:generate &&`.** Rejected:
it multiplies the race described above and runs generation up to four times per
pipeline.
