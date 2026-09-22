# ADR-003 — Server-authoritative gameplay

## Status

Accepted

## Date

2026-09-22

## Context

Eternal Forge is competitive: it has rankings, an arena, guild contributions and
seasons. The client is a web page. It can be read, modified, automated and
replayed by anyone who wants to.

Any value the client is allowed to assert — damage dealt, gold earned, stage
reached, item rolled — becomes a value an attacker can assert, and a leaderboard
built on asserted values is worthless.

## Decision

The server decides every gameplay outcome. The client presents state and sends
_intent_.

The client never determines damage, rewards, XP, gold, drops, crafting results,
upgrade results, PvP results, leaderboard values or prestige rewards. The server
validates the intent, executes the rule in game-core, persists the result and
returns the new state.

Corollaries adopted with this decision:

- Player identity comes from the authenticated server context, never from a
  `playerId` in a request body.
- Every player-owned resource is ownership-checked before it is touched.
- Server time is authoritative; the device clock is input, not evidence.
- Economy operations are transactional, and the ones that can be retried are
  idempotent.

## Consequences

- Every gameplay action costs a round trip. The UI must therefore be built
  around pending states and honest optimistic updates, never around faking a
  completed economy operation.
- The API is the only place gameplay is implemented, so it is also the only
  place that needs hardening — a smaller attack surface than a shared-trust
  design.
- Client-side prediction, if it is ever added, is presentation only and must be
  reconciled against the server result.

## Alternatives Considered

**Trust the client, validate anomalies afterwards.** Rejected: detection is
always behind, and an idle game's numbers grow fast enough that "plausible" is
hard to define. Rankings would be permanently suspect.

**Obfuscate the client to make cheating harder.** Rejected as a primary defence:
it is security through obscurity, it does not survive a determined attacker, and
it makes the client harder to debug for everyone else.

**Full client simulation with server-side replay verification.** Rejected for
now: it doubles the trusted surface and demands byte-identical determinism on
arbitrary browsers. Deterministic simulation (ADR-005) keeps this option open
for later, targeted verification.
