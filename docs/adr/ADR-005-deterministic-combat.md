# ADR-005 — Deterministic, seeded simulation

## Status

Accepted

## Date

2026-09-22

## Context

Combat resolves thousands of times per player per session and must be
reproducible for three reasons: a bug report has to be replayable, an arena
match has to be verifiable, and a balance change has to be measurable against a
known baseline.

`Math.random()` makes all three impossible. So does reading the ambient clock
inside a rule.

There is also a security dimension: if a client can influence the seed, it can
search for a seed that produces a favourable roll.

## Decision

Simulations are deterministic functions of `(input, seed, rulesVersion)`.

- Gameplay code never calls `Math.random()` or `Date.now()`. It uses an explicit
  RNG abstraction and receives time as an argument. This is enforced by lint
  rules and by the game-core guard test (ADR-002).
- Seeds are produced server-side from server-held state. A client may never
  choose, submit or influence a seed that determines a reward.
- `GAME_RULES_VERSION` identifies the rule set a result was produced under. Any
  persisted simulation result records the version in force at the time, so a
  replay is compared against the rules that actually applied rather than
  against today's balance.
- The version is bumped whenever a change alters the outcome of an existing
  simulation. Purely additive content that no prior simulation could reference
  does not require a bump.

Phase 0 introduces the constant and the guard rails only; the RNG and the
simulation land in Phase 1.

## Consequences

- Bug reports reduce to a seed and an input, which makes regression tests cheap
  to write for gameplay defects.
- Balance changes are testable: run the same inputs under two rule versions.
- Replay-based verification of arena results stays available as an option.
- Every persisted simulation result carries an extra column, and every balance
  change requires a conscious decision about whether to bump the version.

## Alternatives Considered

**Ambient `Math.random()`.** Rejected: no reproduction, no replay, no meaningful
regression test for a gameplay bug.

**Recording every roll instead of a seed.** Rejected as the default: it stores
far more data for the same information, and it does not protect against a rule
change altering how the rolls are consumed.

**Ignoring rule versioning until it hurts.** Rejected: the cost of adding the
column now is trivial; the cost of discovering after a balance patch that no
historical result can be reproduced is not.
