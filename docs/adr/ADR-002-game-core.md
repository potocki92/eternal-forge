# ADR-002 — Framework-independent Game Core package

## Status

Accepted

## Date

2026-09-22

## Context

Gameplay rules — damage, scaling, loot, progression, prestige, offline
simulation — are the most valuable and longest-lived code in the project. They
must run in at least three places: inside the API when resolving a player
action, inside the worker when processing offline progress or events, and inside
a test with no infrastructure at all.

Rules embedded in a NestJS service would be unusable from the worker without
booting Nest, unusable from a test without mocking a framework, and impossible
to reason about in isolation.

## Decision

Gameplay rules live in `packages/game-core`, a pure TypeScript package that must
not depend on React, Next.js, NestJS, Prisma, Supabase, Redis, BullMQ, PixiJS,
HTTP clients or database libraries — and, beyond CLAUDE.md's list, not on Node
built-ins, ambient time or ambient randomness either.

The boundary is enforced twice:

1. `@eternal-forge/eslint-config/game-core` forbids those imports, `Math.random`,
   `Date.now` and browser globals.
2. A guard test in the package itself re-checks the manifest and scans sources,
   so a violation fails CI even if a rule is disabled inline or a file escapes
   linting.

Inputs a rule needs from the outside world — the current time, a random seed —
are passed in as arguments.

## Consequences

- Gameplay can be unit-tested at speed, with no database, network or browser.
- The same rule code produces the same result in the API, the worker and a
  replay tool.
- Callers must supply time and randomness explicitly. This is more verbose and
  is the point: it is what makes simulations reproducible.
- Anything game-core needs from infrastructure has to be modelled as data passed
  in, which keeps the engine data-driven by construction.

## Alternatives Considered

**Rules inside NestJS services.** Rejected: couples the rules to a framework and
to dependency injection, and makes the worker import the HTTP application.

**Rules duplicated between client and server for prediction.** Rejected for now:
two implementations drift, and the client is not authoritative anyway
(ADR-003). Sharing the one package with the client for _display-only_
estimation remains possible precisely because the package is framework-free.

**Allowing Node built-ins in game-core.** Rejected: permitting `node:crypto` or
`node:fs` invites ambient randomness and file-based content loading, both of
which break determinism and portability.
