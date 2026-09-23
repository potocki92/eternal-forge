# Eternal Forge API — Agent Instructions

These instructions apply to `apps/api`.

Read the repository root `AGENTS.md` first.

The API orchestrates authenticated server-authoritative gameplay.

It is not the gameplay engine.

---

# 1. Architecture

Preserve the flow:

HTTP
→ Controller
→ Application Use Case
→ Domain / Game Core
→ Repository Port
→ Infrastructure Adapter
→ PostgreSQL

Controllers must remain thin.

Controllers must not directly use Prisma.

Repositories must not implement gameplay rules.

---

# 2. Authentication

Identity comes from verified authentication.

Never trust client-provided:

- userId
- authUserId
- profileId

as proof of identity.

Do not merely decode JWTs.

Use the accepted verification architecture.

Reject invalid, expired or otherwise unacceptable tokens.

---

# 3. Authorization

Ownership must be checked server-side.

Where practical, scope database operations by both:

resource identifier
AND
authenticated owner identity.

Never fetch arbitrary player-owned data and assume the client is authorized.

---

# 4. Gameplay Authority

The API may orchestrate gameplay but must not independently calculate:

- damage
- enemy stats
- boss status
- rewards
- XP rules
- stage progression
- victory/defeat

Use Game Core.

---

# 5. Randomness

Authoritative gameplay seeds must be generated server-side using cryptographically secure randomness.

Never accept an authoritative RNG seed from the browser.

Do not expose seeds unnecessarily.

---

# 6. Combat Transactions

Combat persistence must remain atomic.

A logical combat action must not partially commit:

- progression
- reward
- XP
- level
- stage state
- CombatRun

Use appropriate database transactions.

Keep transactions as short as practical.

---

# 7. Concurrency

The API must support multiple instances.

Do not use process-local locks for gameplay correctness.

Preserve database-backed optimistic concurrency unless an accepted ADR changes the design.

Concurrency conflicts must not create duplicate rewards.

---

# 8. Idempotency

Gameplay mutation retries must be safe.

Preserve the existing idempotency mechanism.

The same logical combat retry must not apply progression twice.

Do not remove database uniqueness guarantees used by idempotency.

---

# 9. Progression

API must preserve:

- currentStage
- highestStageReached
- highestStageCleared

These values come from authoritative domain transitions.

Do not recompute their rules independently in controllers or repositories.

---

# 10. Numeric Safety

Do not convert authoritative StageNumber values to JavaScript number.

Use exact bigint / StageNumber semantics.

HugeNumber persistence must remain exact.

Wire values must use canonical serialization.

---

# 11. Prisma

Prisma belongs in infrastructure adapters.

Do not import Prisma directly into controllers.

Avoid leaking Prisma models into public API contracts.

Map persistence models to application/domain representations.

---

# 12. Error Handling

Distinguish expected domain/application failures from genuine server defects.

Do not return generic HTTP 500 for known expected conditions if a stable application error can represent them cleanly.

Do not leak:

- SQL details
- stack traces
- secrets
- tokens
- internal credentials

to clients.

---

# 13. Supabase

Supabase service-role / privileged credentials are server-only.

Never expose them through browser environment variables.

Do not log tokens.

Keep auth verification architecture testable without requiring unstable external network calls in standard CI.

---

# 14. Tests

Changes to authenticated gameplay should consider:

- unauthenticated request
- invalid token
- expired token
- ownership violation
- tampered payload
- duplicate request
- concurrent request
- multiple API instances
- transaction rollback
- persistence correctness

Database concurrency behavior must be tested against real PostgreSQL where relevant.

---

# 15. Scope

Do not add:

- WebSockets
- queues
- Redis orchestration
- additional infrastructure

unless the task requires it and the architecture justifies it.

Prefer the simplest correct server-authoritative design.
