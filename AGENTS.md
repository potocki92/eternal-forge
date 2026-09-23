# Eternal Forge — Agent Instructions

This file defines mandatory engineering rules for AI coding agents working on Eternal Forge.

These instructions apply to the entire repository unless a more specific nested `AGENTS.md` provides additional rules.

## 1. Mandatory Context

Before making non-trivial changes:

1. Read this `AGENTS.md`.
2. Read `CLAUDE.md`.
3. Read `docs/ROADMAP.md`.
4. Read `docs/ARCHITECTURE.md`.
5. Read `docs/GAME_DESIGN.md`.
6. Read relevant ADRs.
7. Inspect the existing implementation.
8. Inspect existing tests for the affected area.
9. Inspect current branch / PR state.

Do not assume documentation from a previous conversation is current.

The repository is the source of truth.

If documentation and implementation disagree, identify the conflict before making architectural changes.

---

# 2. Project Architecture

Eternal Forge is a server-authoritative persistent idle RPG.

Primary architecture:

Browser
→ Supabase Auth
→ NestJS API
→ Application Use Cases
→ Game Core
→ Repository Ports
→ Infrastructure
→ PostgreSQL

Presentation must not become gameplay authority.

## Responsibilities

### Game Core

Owns deterministic gameplay rules.

Examples:

- combat
- enemy generation
- stage scaling
- rewards
- progression
- level calculations
- boss determination
- deterministic RNG
- HugeNumber
- StageNumber

### API

Owns orchestration.

Examples:

- authentication
- authorization
- application use cases
- transactions
- idempotency
- concurrency
- persistence orchestration

### Web

Owns presentation.

Examples:

- UI
- routing
- API state
- accessibility
- animation
- PixiJS rendering

### Database

Owns persistence and integrity.

It must not become an alternative gameplay engine.

---

# 3. Server Authority

The server is authoritative for gameplay.

Never trust client-provided:

- userId
- authUserId
- profileId
- ownership
- stage
- currentStage
- highestStageReached
- highestStageCleared
- level
- experience
- gold
- damage
- enemy stats
- combat outcome
- victory
- defeat
- rewards
- RNG seed
- boss status

Authentication identity must come from a verified authentication token.

Ownership must be verified server-side.

The client requests actions.

The server determines results.

---

# 4. Stage Progression

Eternal Forge distinguishes three concepts.

## currentStage

The stage currently being fought or farmed.

## highestStageReached

The highest stage the character has ever reached/unlocked.

This value must never decrease.

## highestStageCleared

The highest stage the character has actually defeated.

This value must never decrease once established.

Future primary progression rankings should use `highestStageCleared`, not `currentStage`.

A character may intentionally farm:

currentStage < highestStageReached

This is valid.

Example:

currentStage = 9
highestStageReached = 10
highestStageCleared = 9

means:

The character reached Stage 10, failed the boss, and is farming Stage 9.

Do not collapse these concepts back into a single `stage` field.

---

# 5. Numeric Safety

Authoritative gameplay must never lose numeric precision.

## StageNumber

Use StageNumber for stage values.

Do not convert authoritative StageNumber values to JavaScript `number`.

Persistence:

PostgreSQL BIGINT

Domain:

StageNumber / bigint

Wire format:

canonical decimal string

## HugeNumber

Use the existing deterministic HugeNumber implementation for large gameplay quantities.

Examples:

- damage
- HP
- gold
- experience
- future power values

Do not replace HugeNumber with JavaScript floating point.

Do not introduce unsafe bigint → number conversions.

---

# 6. Determinism

Authoritative gameplay must be deterministic.

The same:

- authoritative input,
- RNG seed,
- GAME_RULES_VERSION

must produce the same result.

Never use `Math.random()` for authoritative gameplay.

Game Core must not depend on wall-clock time.

Random seeds used for real gameplay must originate server-side.

The client must never select authoritative combat seeds.

---

# 7. GAME_RULES_VERSION

Persisted combat history depends on rules versioning.

Once a GAME_RULES_VERSION has been used for real persisted combat history, it is immutable.

Do not silently modify old rules.

Future gameplay/balance changes require a new rules version when deterministic historical behavior would change.

Before modifying gameplay rules, explicitly evaluate whether GAME_RULES_VERSION must change.

---

# 8. Persistence

Persist source state rather than unnecessary derived values.

Gameplay mutations must preserve atomicity.

For combat, values such as:

- rewards
- XP
- level progression
- stage progression
- character version
- CombatRun

must commit atomically where they form one logical gameplay action.

Never intentionally create partial progression states.

---

# 9. Concurrency

Eternal Forge must eventually support multiple API instances.

Never solve distributed gameplay concurrency with:

- in-memory mutexes,
- process-local locks,
- module-level flags.

Use database-backed concurrency mechanisms.

Preserve the existing optimistic concurrency/version architecture unless an accepted ADR replaces it.

Concurrent requests must not produce:

- duplicate rewards,
- duplicate XP,
- duplicate stage advancement,
- duplicated combat records,
- lost updates.

---

# 10. Idempotency

Network retries must be safe.

Retrying the same logical gameplay action must not duplicate:

- rewards,
- XP,
- gold,
- stage progression,
- CombatRun records.

Preserve existing idempotency semantics.

Do not weaken database uniqueness constraints used for idempotency.

---

# 11. Authentication and Authorization

Supabase provides authentication identity.

Eternal Forge provides game/application identity and authorization.

Do not create a second password system.

Never store plaintext passwords.

Never log:

- passwords,
- access tokens,
- refresh tokens,
- service-role keys.

Supabase privileged credentials must remain server-only.

Never expose service-role or equivalent privileged keys through `NEXT_PUBLIC_*`.

---

# 12. TypeScript

Maintain strict type safety.

Do not use `any` as an escape hatch.

Do not use:

- `@ts-ignore`
- unnecessary `@ts-expect-error`
- unsafe casts

to hide design problems.

Do not weaken tsconfig to make CI pass.

Fix the actual type problem.

---

# 13. Linting

Do not disable lint rules merely to make CI green.

If a lint rule appears incorrect for a legitimate case, investigate first.

Repository-wide rule changes require architectural justification.

---

# 14. Architecture Boundaries

Do not move responsibilities across layers casually.

Controllers must not become repositories.

Repositories must not become gameplay engines.

React must not become gameplay authority.

PixiJS must not calculate combat.

SQL must not duplicate Game Core rules.

If a requested change conflicts with an accepted ADR:

STOP.

Explain the conflict before changing architecture.

---

# 15. Scope Discipline

Do not implement future ROADMAP phases unless explicitly requested.

Avoid opportunistic refactors unrelated to the task.

Prefer focused changes.

Do not redesign working architecture while fixing an unrelated bug.

---

# 16. Testing

Before considering non-trivial work complete, run relevant:

- format check
- lint
- typecheck
- unit tests
- integration tests
- production build

For gameplay changes additionally verify:

- deterministic replay
- Game Core purity
- numeric precision
- relevant golden/property tests

For persistence changes additionally verify:

- migrations
- PostgreSQL integration
- constraints
- concurrency
- idempotency

For web changes additionally verify:

- relevant Playwright tests
- mobile viewport
- desktop viewport

Do not delete or weaken tests merely to make a change pass.

---

# 17. Database Changes

Use version-controlled migrations.

Do not manually mutate remote production schemas as a substitute for migrations.

For schema changes:

1. update schema,
2. create migration,
3. test from empty database,
4. test compatibility where required,
5. verify schema drift.

Preserve database constraints protecting domain invariants.

---

# 18. Supabase

Supabase remote environments do not replace reproducible local development and CI.

Never commit Supabase secrets.

Public browser-safe configuration and privileged server configuration must remain clearly separated.

Migration history belongs in Git.

---

# 19. Frontend

Primary mobile target:

390 × 844.

Desktop must remain functional.

The game should look like a game, not an admin dashboard.

Accessibility must remain available even when PixiJS/canvas is used.

Authoritative gameplay state comes from the API.

---

# 20. Git and Pull Requests

Never merge a pull request automatically unless the user explicitly requests it.

Never push directly to `main` unless explicitly requested.

Do not force-push shared branches without explicit permission.

Prefer focused branches and PRs.

Before declaring a PR ready:

1. inspect the complete diff,
2. run required validation,
3. check CI,
4. perform self-review,
5. report remaining risks.

A red CI run is a merge blocker unless explicitly determined otherwise by the repository owner.

---

# 21. Security

Never commit secrets.

Never expose privileged credentials.

Never trust client ownership claims.

Never log sensitive authentication material.

Treat economy/progression mutations as security-sensitive.

When implementing gameplay mutations, consider:

- replay attacks,
- duplicate submissions,
- concurrent requests,
- authorization bypass,
- ownership bypass,
- tampered request payloads.

---

# 22. Working Method

Before coding:

1. understand the requested task,
2. inspect relevant implementation,
3. inspect relevant tests,
4. inspect relevant ADRs,
5. identify architectural impact.

During coding:

1. make focused changes,
2. preserve boundaries,
3. add/update tests with implementation,
4. avoid unrelated cleanup.

After coding:

1. review the diff,
2. run validation,
3. check architecture boundaries,
4. check security implications,
5. update documentation if behavior or architecture changed.

Then report:

- what changed,
- why,
- tests executed,
- CI state,
- migrations,
- architectural decisions,
- remaining risks.

Do not claim success if required validation has not actually passed.
