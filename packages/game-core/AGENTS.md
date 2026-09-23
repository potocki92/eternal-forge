# Eternal Forge Game Core — Agent Instructions

These instructions apply to `packages/game-core`.

Read the repository root `AGENTS.md` first.

Game Core is the deterministic gameplay authority of Eternal Forge.

Correctness and determinism are more important than convenience.

---

# 1. Purity

Game Core must remain independent from infrastructure and presentation.

Never import:

- React
- Next.js
- NestJS
- Prisma
- Supabase
- Redis
- BullMQ
- PixiJS
- HTTP clients
- database clients

Game Core must not perform:

- network requests
- database queries
- filesystem access
- environment-variable reads
- browser storage access

---

# 2. Determinism

The same:

input
+ seed
+ GAME_RULES_VERSION

must produce the same result.

Never use `Math.random()`.

Never use wall-clock time as gameplay input unless it is explicitly provided as deterministic input by the caller.

Do not hide nondeterminism behind utility functions.

---

# 3. RNG

Use the project's deterministic RNG implementation.

Real gameplay seeds originate outside Game Core and are supplied explicitly.

Game Core consumes seeds.

Game Core does not generate cryptographic randomness.

---

# 4. HugeNumber

HugeNumber is authoritative numeric infrastructure.

Do not replace it with floating-point arithmetic.

Avoid authoritative use of:

- Math.pow
- Math.log
- Math.log10
- Math.exp

where doing so would compromise deterministic HugeNumber semantics.

Preserve canonical normalization and serialization.

Changes require strong tests.

---

# 5. StageNumber

Stage values use StageNumber.

Do not convert authoritative stages to JavaScript number.

Use bigint-safe operations.

Preserve PostgreSQL BIGINT compatibility.

StageNumber must not be weakened to represent unrelated states.

For example, do not introduce Stage 0 merely to represent "no stage cleared".

Use explicit domain modeling instead.

---

# 6. Stage Progression

Maintain the distinction between:

- currentStage
- highestStageReached
- highestStageCleared

Progression transitions belong in Game Core.

API, React and repositories must not independently recreate progression rules.

Historical progression values must not decrease.

A farming stage may be below the historical maximum.

---

# 7. Combat

Combat simulation must be pure.

Conceptually:

simulateCombat(character, enemy, seed, rulesVersion)

must not require infrastructure.

Combat must not know about:

- HTTP
- authentication
- Prisma
- database transactions
- React
- PixiJS

Combat returns authoritative simulation data.

Presentation layers animate the result.

---

# 8. Rewards

Reward calculation belongs in Game Core.

Do not calculate rewards separately in:

- API controllers
- repositories
- SQL
- frontend

Defeat must not accidentally receive victory rewards.

---

# 9. Progression

Leveling, XP requirements and stage progression are gameplay rules.

They belong here.

Avoid duplicating progression formulas elsewhere.

---

# 10. Rules Versioning

Before modifying deterministic gameplay behavior, evaluate GAME_RULES_VERSION.

Once a rules version has persisted production combat records, it is immutable.

Do not silently alter historical rules.

---

# 11. Tests

Gameplay-rule changes require appropriate:

- unit tests
- deterministic replay tests
- edge-case tests
- golden vectors where useful
- property-based tests where useful

Test invariants, not only examples.

Examples:

- historical stage progression never decreases
- defeat cannot grant victory reward
- same seed produces same combat
- serialization round-trips
- numeric invariants remain valid

---

# 12. Performance

Correctness first.

Do not introduce floating-point shortcuts merely for speed.

Benchmarks must remain separate from standard correctness tests when appropriate.

Avoid premature optimization.

---

# 13. Forbidden Shortcuts

Do not:

- use `any`
- hide errors with casts
- add framework dependencies
- duplicate rules for convenience
- read environment variables
- generate server randomness
- depend on persistence models

If infrastructure requirements appear necessary inside Game Core, reconsider the architecture first.
