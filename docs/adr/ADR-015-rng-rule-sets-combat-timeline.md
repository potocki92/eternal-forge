# ADR-015 — Deterministic RNG, versioned rule sets and the combat timeline

## Status

Accepted — 2026-09-22 (Phase 1)

## Date

2026-09-22

## Context

ADR-005 requires every simulation to be a deterministic function of
`(input, seed, rulesVersion)`, but leaves three things open that Phase 1 has to
decide before the first combat can run:

1. **Which generator**, and how a seed becomes generator state. Whatever is
   chosen becomes part of the game rules: changing it changes every seeded
   outcome.
2. **What `rulesVersion` points at.** A version number is only useful if the
   engine can execute the rules it names, including older ones, when a
   persisted result is replayed.
3. **How combat time works.** Attack speed is naturally fractional (1.3 attacks
   per second), and deciding which of two attacks lands first from rounded
   floating-point times makes ordering depend on rounding error.

A fourth constraint comes from the user: authoritative calculations must not
use `Math.pow`, `Math.log10`, `Math.exp` or any other function ECMAScript lets
engines approximate.

## Decision

### RNG

- The generator is **xoshiro128\*\* 1.1** (Blackman and Vigna). It is defined
  entirely by 32-bit `Math.imul`, shifts, rotations and xor, all of which the
  language specifies exactly. It is verified against the published reference
  output for state `[1, 2, 3, 4]`.
- A seed is an opaque **string** of 1–256 characters, chosen by the server
  (ADR-005). It is hashed to the 128-bit state with **cyrb128** over UTF-16
  code units. The hash is non-cryptographic. That is sufficient because the
  client never chooses a seed; the security property is server custody of the
  seed, not unpredictability of the hash.
- Child seeds come from `deriveSeed(seed, ...labels)`, a length-prefixed hash
  to 32 hex characters. `simulateStages` uses `deriveSeed(seed, 'stage', n)`,
  so a stage's result does not depend on where a run started.
- `nextInt` removes modulo bias by rejection. `chance(bp)` always consumes
  exactly one draw, so changing a chance never shifts the rest of the stream.
- Golden vectors for the seed hash and the stream are committed. Their expected
  values come from an independent Python implementation.

### Versioned rule sets

- Balance is data: a frozen `GameRules` object per version, registered by
  version number. `getGameRules(version)` returns it, or throws
  `UNSUPPORTED_RULES_VERSION`.
- `GAME_RULES_VERSION` is the version new results are produced under. Phase 1
  sets it to 1 (`RULES_V1`).
- Simulation entry points take `rulesVersion`, not a rules object, and record
  it in their result. A persisted result therefore always names the rules that
  produced it, and a replay resolves exactly those rules.
- A balance change adds a new rule set under a new version. It does not edit
  an existing one once results produced under it may have been persisted.
- The version is bumped for any change that alters an existing outcome. That
  includes HugeNumber rounding, the `pow` algorithm, the RNG, seed hashing and
  the combat timeline, not only balance numbers. Golden simulation fingerprints
  make such a change fail a test instead of passing silently.

### Combat timeline

- Rates are integer **basis points**: attack speed (10 000 = one attack per
  second), critical chance and critical damage. No binary floating-point value
  decides an outcome.
- A side's `k`-th attack lands at exactly `k × 10 000 / attackSpeedBp`
  seconds. Two attacks are ordered by comparing `kA × speedB` with
  `kB × speedA`, exact integer products. A tie resolves player first.
- Milliseconds appear only in the reported result, floored by integer
  division.
- A combat still undecided at the rule set's time limit is a loss
  (`TIME_LIMIT`). Together with the attack-speed cap, the time limit bounds the
  work of any single combat: at most 300 attacks per side under rules v1.

### Enforcement

`Math.random`, `Date.now` and every implementation-approximated `Math` function
(`pow`, `exp`, `log*`, trigonometric and hyperbolic functions, `cbrt`,
`hypot`) are banned in `packages/game-core` sources. Two checks enforce this:
the ESLint rules, and the guard test that scans the sources (ADR-002).

## Consequences

- A combat is reproducible from `(player stats, enemy stats, seed, rulesVersion)`
  alone, and the tests prove it bit-for-bit through SHA-256 fingerprints of the
  serialised result. The compiled package run under plain Node produces the same
  fingerprints as the test runner.
- Old results stay replayable only as long as their rule set stays registered.
  Removing a rule set is a data-retention decision, not a refactor.
- Every balance patch now costs a new rule set and a version bump. That is
  deliberate.
- Fractional attack speeds cost nothing in accuracy. There is no accumulated
  drift over a long combat.
- xoshiro128\*\* is not cryptographically secure. Nothing in the design relies
  on unpredictability; if a future mechanic does, it needs its own decision.

## Alternatives Considered

**Mulberry32 / SplitMix32.** Smaller, but a 32-bit state gives only 2^32
distinct streams, and their statistical quality is weaker. Rejected.

**PCG32 or xoshiro256\*\*.** Both need 64-bit arithmetic, which in JavaScript
means `bigint` on the hottest path of combat. Rejected for Phase 1.

**A cryptographic hash (SHA-256) for seeding.** It would require `node:crypto`,
which Game Core may not import (ADR-002), or a hand-written implementation.
That buys unpredictability the design does not need. Rejected.

**Numeric seeds.** Simpler, but they limit the seed space and push hashing onto
every caller. Rejected in favour of strings, which accept any server
identifier.

**Floating-point attack timers with a fixed tick.** Common in games, but event
order then depends on tick rounding, and results shift when the tick changes.
Rejected in favour of exact rational times.

**Balance constants in engine code, with the version as a label only.**
Replaying an old result would then run today's formulas. Rejected: it defeats
the purpose of recording a version.
