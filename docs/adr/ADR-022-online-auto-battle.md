# ADR-022 — Online auto-battle: a client loop over the authoritative combat

## Status

Proposed — 2026-09-23 (Phase 4, PR 4.2). Awaiting user approval.

## Date

2026-09-23

## Context

Players want the hero to keep fighting without tapping Fight for every
combat. Phase 4 delivers this in two separate steps:

- **Online auto-battle (this ADR).** While the game is open, the client keeps
  fighting.
- **Offline progression (PR 4.3).** Progress for time the game was *closed*,
  computed on the server from elapsed server time.

They must not blur. If online auto-battle ever produced progress for time the
client was not actively fighting, it would be an unbounded, unaudited
offline system under another name.

The existing combat transaction (ADR-019) already provides everything a
repeated fight needs:

- the server decides stage, enemy, seed, outcome and rewards;
- `characters.next_combat_at` occupies the hero for each combat's simulated
  duration, and an earlier request is `409 COMBAT_NOT_READY` with
  `Retry-After` (the **pacing gate**);
- an idempotency key per intent makes a retried lost response a replay;
- the `version` check makes concurrent requests produce one combat, across
  any number of API instances;
- the stage mode (ADR-021) is read from the persisted row on every combat.

The questions: does auto-battle need server state, a new endpoint or a
scheduler? How are timing, retries, several tabs and a sleeping tab handled?

## Decision

### 1. No server-side auto-battle state

Auto-battle is the **client's intent**, held in browser memory only. The
server does not know whether a request came from a tap or from the loop.
There is no new table, column, endpoint, contract, Redis key, worker job or
server loop.

Consequences that follow directly:

- closing the tab, signing out or losing the network ends auto-battle; no
  combat happens on the server without a request;
- a reload always starts with auto-battle **off** (the character state is
  unchanged, being server state);
- nothing about auto-battle can be forged, because there is nothing to forge:
  each fight is an ordinary, fully validated combat request.

### 2. The loop reuses the combat session, unchanged

In `apps/web`, `useAutoBattle` drives the same `fight()` function as the
Fight button (`useCombatSession`): the same request, the same idempotency
key rules (a fresh key per intent, the same key for every retry of it), the
same response handling and cache update. There is no second combat path and
no gameplay logic in the client.

The loop is two pure pieces and one timer:

- `autoBattleReducer` — the intent: `off`, `running` (with a count of
  consecutive failures), `stopping` (Stop pressed while a request is in
  flight), `halted` (with a reason shown to the player);
- `nextAutoBattleStep` — a pure function of the intent and the screen
  (combat phase, result shown, the server's gate, freshness of the player
  state, pending stage choice, page visibility): either *wait* (with the
  reason) or *fight at local time T*;
- one `setTimeout` for T, replaced whenever the inputs change and cleared on
  unmount.

`fight()` ignores a call while a combat is requested or playing, so the loop
can never have two requests in flight.

### 3. Timing: the server's gate, read on the local clock only to decide when to ask

The next fight is sent when the result of the previous one has been shown
(the existing 1.2 s reveal) **and** the server's `nextCombatAt` has passed.
`nextCombatAt` is read relative to the response's `serverTime` and anchored
to the local arrival time (`localReadyAt`), so a wrong device clock only
changes *when the client asks*. Asking too early gets `409`; asking late
wastes the player's time. Neither changes a reward.

The pacing gate stays the one authoritative throttle. No rate limit, cooldown
table or ticket is added.

### 4. No catch-up, and a hidden page starts no fight

A timer that fires late (a throttled background tab, a sleeping laptop)
sends **one** fight when it fires, from the server's current state. Missed
time is never simulated or requested again. The loop additionally **pauses
while the page is hidden** (Page Visibility API) and resumes when it is
visible again: online auto-battle means the player is present. Progress for
absent time is PR 4.3's job, on the server.

### 5. Failures

| Answer                                  | Loop behaviour                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| network loss, timeout, 5xx, 429         | same key; backoff 2 s, 4 s, 8 s, 16 s, 30 s; halts after 5 consecutive failures |
| `409 COMBAT_NOT_READY`                  | re-read player state; fight again with a new key at the new gate, ≥ 1 s later; halts after 10 in a row |
| `409 STAGE_NOT_PLAYABLE`, no encounter  | halts                                                                          |
| 401 (after one token refresh)           | halts; the session ends and the screen unmounts                                |
| 403, 404, other 4xx                     | halts                                                                          |

Each failure counted above already includes the combat session's own two
quick retries of transient errors. A halt is shown with its reason and can be
restarted by the player.

### 6. Stop

Stop prevents the next fight. A request already in flight is *not* aborted
(an aborted HTTP request says nothing about the server's transaction): the
loop enters `stopping`, the answer is shown, and no further fight starts. A
combat being played is already committed and simply plays out.

### 7. Stage choice while running

The stage selector stays usable while a committed combat plays (it is locked
only while a combat request is in flight). The loop waits while a selection
request is pending, so the next fight is sent after the server has stored
the choice. The server reads the mode and stage from the row at the next
combat, as ADR-021 already requires; the client never tells it which stage
to fight. Cross-tab races between a selection and a combat are settled by the
shared `version` (ADR-021 §5).

### 8. Several tabs and devices

Nothing coordinates tabs. Each tab's loop asks at the gate; the server
commits one combat and answers the other `409`. Total throughput is bounded
by the pacing gate — one combat per combat duration per character — however
many tabs, devices or scripts ask. The losing tab re-reads the state and
waits for the new gate.

### 9. Observability

`RunCombatUseCase` logs structured events for every path that does not
resolve a new combat: `combat.replayed` (info), `combat.conflict` (info),
`combat.stage_not_playable` (warn) and `combat.not_ready` (debug, because a
spamming client produces one per request). Fields: character id, combat id,
wait, resolution. Never a token, seed or request body. `PinoLoggerService`
now records object messages as fields.

## Consequences

- Online auto-battle cannot out-earn manual play: both are bounded by the
  same gate, and every fight is a normal recorded `combat_runs` row.
- No schema change, no contract change, no new endpoint. The server change is
  logging only.
- Legitimate traffic is at most one combat request per combat duration plus
  the 1.2 s reveal and a round trip. Under rules v1 a combat lasts 1–30 s, so
  a character sends at most ~0.5 requests/s on auto. Retries add at most one
  request per backoff step.
- Two tabs on auto each send requests and one of them is refused per window:
  wasteful but bounded (≈ 2 requests per combat).
- Auto-battle does not survive a reload or continue in a hidden tab. This is
  intended; a player who wants progress while away gets it from PR 4.3.
- General rate limiting is still not implemented (docs/SECURITY.md). The gate
  bounds progress, not request volume; a refused request costs one
  owner-scoped read.

## Alternatives Considered

**A server-side auto-battle session (`auto_battle_until`, a flag, a
heartbeat).** Rejected: it adds state that must expire correctly and invites
the server to fight without a present client, which is offline progression
without its cap and audit. The client intent is enough.

**A BullMQ or scheduler loop on the server.** Rejected: permanent background
combat for every "online" player is exactly what docs/ARCHITECTURE.md
forbids ("Never run a permanent simulation loop"). Out of scope by the task.

**A batch endpoint ("fight N times").** Rejected: it duplicates the combat
transaction's idempotency and pacing for no gain; a request per combat is
cheap.

**WebSockets / server push of the next combat.** Rejected: no requirement; the
response already carries `nextCombatAt`.

**Cross-tab coordination (BroadcastChannel, Web Locks).** Deferred: the
server already guarantees correctness; coordination would only save the
refused requests. It can be added later without a server change.

**Keep fighting in a hidden tab.** Rejected for now: timers are throttled to
unpredictable rates, and it blurs online and offline progression. Flagged
for the product owner.

**A Redis rate limiter for the combat endpoint in this PR.** Deferred: the
gate already bounds gameplay; request-volume limiting is a cross-cutting
concern planned separately (docs/SECURITY.md — PLANNED), and Redis is not
added "because it exists".
