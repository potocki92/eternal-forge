# ADR-008 — pnpm workspace, Turborepo and the shared toolchain

## Status

Accepted

## Date

2026-09-22

## Context

Phase 0 has to place three applications and six packages in one repository and
keep their configuration from diverging. Three questions had to be answered
before any code was written: which package manager, which task runner, and
where shared configuration lives.

A secondary concern is version drift. In a workspace this size, the same library
silently resolving to different versions in different packages is a recurring
source of hard-to-explain bugs.

## Decision

**pnpm workspaces** with a **catalog**. Every shared dependency version is
declared once in `pnpm-workspace.yaml` under `catalog:` and referenced as
`"pkg": "catalog:"` in each manifest. Upgrading is a one-line change and drift
is not expressible.

**Turborepo** for task orchestration. Tasks declare `dependsOn: ["^build"]`, so
`pnpm run test` builds the packages a test needs and nothing else, and unchanged
packages are served from cache.

**Shared configuration as packages**:

- `packages/typescript-config` — `base` (strict options), plus `node-library`,
  `nest`, `nextjs` and `react-library` presets.
- `packages/eslint-config` — flat configs: `base`, `game-core`, `nest`,
  `react-library`, `next`.
- `packages/config` — runtime environment validation (ADR-010). Distinct from
  the two above, which configure _tooling_.

**Strictness**: `strict`, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax`. ESLint runs
`strictTypeChecked` with the typescript-eslint project service, so type-aware
rules work without each package maintaining a project list.

**Testing**: Vitest for unit and integration tests in every package, including
`apps/api` — NestJS's default Jest setup would add a second runner and a second
transform pipeline for no benefit. NestJS needs `emitDecoratorMetadata`, which
esbuild does not implement, so `apps/api` transforms tests with SWC via
`unplugin-swc`. Playwright covers end-to-end.

**Node 22**, pinned via `.nvmrc` and the root `engines` field.

**Internal package format**: `config`, `contracts`, `game-core` and `database`
compile to `dist/` and are consumed as build artefacts. `ui` exports TypeScript
source and is compiled by the consuming application (`transpilePackages`),
because it ships JSX and client components that only a bundler consumes.

## Consequences

- Adding a package means writing a manifest and extending two shared configs;
  there is no per-package tooling to maintain.
- `pnpm run verify` reproduces the CI gate locally: format, lint, typecheck,
  test, build.
- Turborepo's cache makes repeated local runs cheap, at the cost of task inputs
  and outputs having to be declared correctly.
- The strict TypeScript settings reject code that looser projects accept. That
  is the intent; `noUncheckedIndexedAccess` in particular catches a whole class
  of array-access bugs before they reach gameplay.
- `engine-strict` is off: transitive tooling occasionally pins a Node patch
  version newer than a given workstation's. The supported range is still
  documented in `engines` and enforced in CI through `.nvmrc`.

## Alternatives Considered

**npm or Yarn workspaces.** Rejected: pnpm's non-flat `node_modules` prevents
accidental reliance on undeclared transitive dependencies, and no other package
manager offers the catalog.

**Nx.** Rejected: more capable than this project needs, with a heavier
conceptual surface; Turborepo's model is a task graph and a cache, which is
exactly the requirement.

**No monorepo — separate repositories.** Rejected: `packages/contracts` exists
precisely so client and server cannot drift, which only works when they are
versioned together.

**Jest for `apps/api`.** Rejected: a second runner, a second config format and a
second transform for the sake of a framework default.
