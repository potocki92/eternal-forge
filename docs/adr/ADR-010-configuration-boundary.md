# ADR-010 — Validated configuration with a server/client split

## Status

Accepted

## Date

2026-09-22

## Context

Two failure modes needed designing out before any feature depended on
configuration.

The first is the late failure: a missing or malformed environment variable that
surfaces as a confusing runtime error on the first request that happens to need
it, often in production.

The second is more serious. `apps/web` and `apps/api` share packages. Supabase
issues a service-role key that bypasses Row Level Security. If server
configuration is reachable from code a bundler can pull into a client build, a
refactor can ship that key to browsers, and nothing in the type system would
object.

## Decision

`packages/config` owns environment validation, with the server/client split
expressed in the module graph rather than in a naming convention.

- `@eternal-forge/config/server` exposes privileged loaders. The module throws
  on import if it detects a browser runtime.
- `@eternal-forge/config/client` exposes browser-safe configuration only. A test
  asserts every key it exposes starts with `NEXT_PUBLIC_`.
- The package root exports schemas and helpers, so importing it can never pull
  in a server secret.
- Validation is Zod-based and runs at process start. Failures list every
  offending variable at once, identified by name. **Values are never included in
  the message** — an environment variable is a credential, and an error message
  is a log line.
- Applications receive configuration by injection (`API_ENV` in NestJS,
  arguments elsewhere). Nothing outside `packages/config` reads `process.env`
  for application settings.
- Supabase credentials are validated lazily, when a privileged client is
  constructed, rather than at process start: authentication arrives in Phase 2,
  and requiring them now would make every local run and every CI build depend on
  credentials nothing reads.

`apps/web` passes an explicit object literal of `process.env.NEXT_PUBLIC_*`
accesses, because Next.js only inlines statically visible member expressions.

## Consequences

- A misconfigured deployment fails at boot with a complete, readable list.
- Shipping a server secret to the browser requires deliberately importing a
  module that refuses to load there.
- Adding a variable means editing a schema and `.env.example`, which keeps the
  template honest.
- `apps/web` relaxes `noPropertyAccessFromIndexSignature` because Next's inlining
  requires dot access. The exception is scoped to that one tsconfig preset.

## Alternatives Considered

**Read `process.env` where needed.** Rejected: no validation, no single list of
what a process requires, and no barrier between server and client configuration.

**One schema for everything.** Rejected: it forces every process to satisfy
every other process's requirements, and it puts privileged variables in the same
module as public ones.

**Validate only in production.** Rejected: development is where a malformed
value should be caught, and a validator that does not run in development is a
validator nobody trusts.
