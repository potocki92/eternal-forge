# ADR-009 — ESM-only workspace

## Status

Accepted

## Date

2026-09-22

## Context

The initial Phase 0 scaffold compiled every Node-side package to CommonJS, which
is the historical default for a NestJS application.

That failed immediately: NestJS 12 ships as pure ESM (`"type": "module"`, no
CommonJS entry point). A CommonJS consumer cannot `require()` it. Next.js and
Vitest are likewise ESM-first.

The workspace therefore had a choice: pin NestJS to an older CommonJS major, or
move the whole workspace to ESM.

## Decision

The workspace is ESM end to end.

- Every package and application declares `"type": "module"`.
- Node-side TypeScript compiles with `module: "NodeNext"` and
  `moduleResolution: "NodeNext"`, so relative imports carry an explicit `.js`
  extension exactly as Node resolves them.
- `verbatimModuleSyntax` is enabled; type-only imports must say so.
- `apps/web` keeps `moduleResolution: "Bundler"`, since Next.js resolves its own
  graph.
- CommonJS dependencies (ioredis, pino, helmet, the generated Prisma client) are
  consumed through Node's ESM/CJS interop. Each interop point was verified to
  resolve at runtime, not merely to typecheck.

## Consequences

- Current major versions of NestJS, Next.js and Vitest are usable without
  interop shims or dynamic `import()` at module boundaries.
- Relative imports must be written with `.js`, including in TypeScript sources.
  This is unfamiliar but mechanical, and it means the emitted code is what
  actually runs.
- A dependency that ships CommonJS with an unanalysable export shape would need
  a default-import workaround. None of the current dependencies do.
- `moduleResolution: "Node"` (node10) is not available, so subpath `exports`
  such as `@eternal-forge/config/server` resolve correctly — which the legacy
  resolver could not do.

## Alternatives Considered

**Stay on CommonJS with NestJS 11.** Rejected: it starts the project one major
version behind on its most central backend dependency, and the migration cost
only grows as more code is written.

**Dual CJS/ESM builds for internal packages.** Rejected: doubles build output,
creates the dual-package hazard, and solves a problem the project does not have
once everything is ESM.

**`moduleResolution: "Bundler"` everywhere to avoid `.js` extensions.** Rejected
for Node-side code: it describes what a bundler does, not what Node does, and
the API and worker run on Node directly with no bundler.
