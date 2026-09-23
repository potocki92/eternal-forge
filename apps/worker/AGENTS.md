# Eternal Forge Worker — Agent Instructions

These instructions apply to `apps/worker`.

Read the repository root `AGENTS.md` first.

The worker executes asynchronous/background application work.

It must not become an alternative gameplay authority.

---

# 1. Architecture

Worker jobs may orchestrate Game Core and persistence.

They must use the same authoritative gameplay rules as the API.

Never create separate worker-only formulas for:

- combat
- rewards
- XP
- progression
- stage scaling
- offline progress

Game Core remains authoritative.

---

# 2. Idempotency

Background jobs may be retried.

Design every persistent job assuming it can execute more than once.

Retries must not duplicate:

- rewards
- XP
- gold
- progression
- economic transactions

Use persistent idempotency mechanisms.

Do not rely on process memory.

---

# 3. Concurrency

Multiple worker instances may eventually run simultaneously.

Do not use in-memory locks for distributed correctness.

Use database/queue-backed mechanisms appropriate to the architecture.

---

# 4. Offline Progress

When offline progression is implemented in a future phase:

do not invent separate progression rules.

Offline simulation must use Game Core.

It must respect:

- currentStage
- highestStageReached
- highestStageCleared
- GAME_RULES_VERSION
- deterministic gameplay rules

Offline farming must not falsely mark unbeaten bosses as cleared.

Example:

currentStage = 99
highestStageReached = 100
highestStageCleared = 99

offline farming may farm Stage 99 according to future rules.

It must not automatically claim Stage 100 was defeated unless the accepted game design explicitly allows offline boss progression.

---

# 5. Numeric Safety

Preserve HugeNumber and StageNumber precision.

Do not convert authoritative stage values to JavaScript number.

---

# 6. Queue Payloads

Treat queue payloads as untrusted input boundaries.

Validate payloads.

Do not place secrets in job payloads.

Prefer identifiers and authoritative database lookups over copying large mutable state into jobs.

---

# 7. Transactions

Economic/progression mutations triggered by jobs must remain atomic where required.

Partial rewards are unacceptable.

---

# 8. Observability

Jobs should provide useful structured logs.

Never log:

- passwords
- access tokens
- refresh tokens
- service-role credentials
- sensitive secrets

Include safe identifiers/correlation information when useful.

---

# 9. Tests

Future worker gameplay jobs require tests for:

- retries
- idempotency
- concurrency
- partial failure
- deterministic Game Core behavior
- persistence correctness
