# ADR-023 — Server-authoritative offline progression

## Status

Proposed — 2026-09-23 (Phase 4, PR 4.3). Awaiting user approval.

## Date

2026-09-23

## Context

A player closes Eternal Forge at 22:00 and returns at 07:00. The hero should
have kept working while they were away. Phase 4 has so far delivered stage
selection and farming (ADR-021) and online auto-battle (ADR-022), which only
runs while a client is open and sends requests. Offline progression is the
server-side counterpart for time the client was *not* there.

The design must answer, together:

1. Who measures the absence, and how the client is kept out of it.
2. How online and offline time share one time line, so no instant is paid
   twice: a player who fights online for 30 minutes and then closes the game
   must not also receive those 30 minutes as offline rewards.
3. What the hero fights while away — without ever defeating an unbeaten boss.
4. How much time counts (a cap), and how the work per request stays bounded.
5. Determinism, replay, atomicity, idempotency and concurrency across devices
   and API instances.
6. What is persisted, and what the combat history becomes.

The existing combat transaction (ADR-019) already provides the building
blocks: server-owned time through the `Clock` port, the pacing gate
`characters.next_combat_at`, a shared optimistic `version`, idempotency keys,
CSPRNG seeds, and a pure Game Core that decides every outcome. ADR-019 §10
named `next_combat_at` as the point up to which the hero's time is consumed,
and the attachment point for offline progress.

## Decision

### 1. Lazy catch-up, on request

Nothing runs while a player is away: no timer, no scheduler, no worker job,
no BullMQ repeatable job, no Redis state. When the client returns it calls

```
POST /player/characters/:characterId/offline-progress
Idempotency-Key: <uuid>          (no body)
```

and the server converts the idle time into progress in that request. A
million offline accounts cost nothing until they come back. `apps/worker` is
untouched; Redis is untouched.

### 2. Server-owned time; the client sends no time

The request has no body; a body, if sent, is ignored. The idle time is
`serverNow − next_combat_at`, both from the API's `Clock` — the same single
clock the pacing gate uses (ADR-019, implementation note 1). A device clock,
a timezone, `localStorage` or a "last seen" value cannot enter the
calculation. A negative interval (a hero still fighting, or a boundary ahead
of an instance's clock) is zero.

### 3. One time line: `next_combat_at` is the processed boundary

The concept the task calls `last_processed_at` already exists and is not
duplicated: **`characters.next_combat_at` is the instant up to which every
moment of the hero's time is accounted for.** Before it, the hero was
fighting (online or offline); after it, the hero is idle.

| Event                  | Moves the boundary to                              |
| ---------------------- | -------------------------------------------------- |
| online combat (manual or auto-battle) | `resolvedAt + durationMs` (unchanged, ADR-019) |
| offline claim that fought | the end of its last fight — never after now      |
| offline claim with nothing to collect | not moved; nothing is written        |
| player-state read      | not moved                                          |
| stage selection        | not moved                                          |

Consequences, which answer the double-accounting question directly:

- **Online time is never paid again offline.** Each online combat starts at
  or after the boundary and moves it to the combat's end. Thirty minutes of
  online play leave at most the idle seconds after the last fight.
- **Idle time is claimable only while it is the latest thing on the time
  line.** An online fight ends it: the idle time before that fight is
  forfeited, never counted twice. The web client therefore claims before it
  fights — on entering the game and whenever the page becomes visible again
  (§12). Auto-battle waits for that claim.
- **Every interval is paid at most once**, because the boundary only moves
  forward and every move is part of the same version-conditional write as the
  rewards it pays for. Each claim covers `(boundary, now]`.

A second timestamp column would have to be kept equal to `next_combat_at` in
every write path; storing one source of truth is simpler and safer.

### 4. The cap: 8 hours of rewarded time, as versioned rule data

`RULES_V1.offline.capMs = 28 800 000` (8 hours) — no earlier product decision
existed, so the task's recommended value is used and **flagged for the owner
to adjust**. The response distinguishes `elapsedMs` (measured) from
`rewardedMs` (`min(elapsed, cap)`) and `capReached`.

When the absence exceeds the cap, the rewarded window is the **last** 8 hours
before the claim (`now − cap … now`); anything older is forfeited — the new
boundary is inside that window, so it can never be claimed later.

`RULES_V1.offline.minimumAbsenceMs = 60 000` (1 minute): shorter idle time is
not converted yet (it keeps accumulating, nothing is written). It is at least
the combat time limit (30 s), so **every eligible claim fits at least one
fight**; there is no fractional reward and no "you were away for 0.7 s".

Both values live in the rule set, not in the UI. `offline` is a new block of
`RULES_V1`: it changes no existing outcome and no persisted result, following
the precedent of ADR-021 §7. From this ADR on it is frozen with rules v1;
changing the cap later needs rules v2.

### 5. What the hero farms: the last proven stage — `min(current, highestCleared)`

`offlineFarmStage(stages)` in Game Core:

- no stage cleared yet (`highestCleared = null`) → **no target**; the claim
  collects nothing until the player has established a farm stage online;
- otherwise `min(current, highestCleared)`:
  - an intentional `FARM` stage at or below the record is respected
    (farm 25 with 40 cleared → farms 25);
  - a hero on its unbeaten frontier — `PROGRESS` at the stage-10 boss
    (`10 / 10 / 9`), or `FARM` on the uncleared frontier boss — farms the last
    stage it has cleared (9).

The target is a simulation input only. **Offline progression never writes the
current stage, the stage mode or a record**: the repository's UPDATE does not
contain those columns. A player who left in `PROGRESS` at boss 50 returns in
`PROGRESS` at boss 50. The database backs it:
`offline_runs.target_stage ≤ highest_stage_cleared` is a CHECK.

### 6. The unbeaten-boss policy

Offline progression never fights an uncleared stage, so it can never clear a
boss, skip one, unlock a stage or set a first clear. Breaking a progression
barrier is always a player action online. (Even the storable-but-unreachable
state `highestCleared = highestReached`, where an online farm win would unlock
the next stage, moves nothing offline — a Game Core test pins this.)

### 7. The simulation reuses the game, fight by fight

`resolveOfflineProgress({ progress, elapsedMs, seed, rulesVersion })` is a
pure Game Core function composed of the ordinary primitives — no
offline-specific formula (no gold per hour, no offline multiplier):

- the enemy is `createEnemyForStage(target)`, the rewards
  `calculateStageRewards(stage)`, both computed once (they do not change);
- fights run back to back, each occupying the hero for its simulated
  duration — the online pacing rule; a fight that would end after the
  rewarded time is not fought, and its remainder stays unprocessed;
- fight `n` is `simulateCombat` with the character's stats **at that moment**
  and seed `deriveSeed(seed, 'offline', n)`;
- a win pays the stage's ordinary reward and applies experience through the
  ordinary level rule, so level-ups strengthen later fights; a loss pays
  nothing and costs only its time. Nothing assumes a 100% win rate.

A test proves it equals `resolveStageAttempt` in `FARM` mode on the target,
repeated (fights, wins, time, level, experience and gold), over 5 minutes,
1 hour and 8 hours, and in a 60-case property test.

### 8. Bounded work

`MAX_OFFLINE_FIGHTS = 30 000` is a hard Game Core limit; a resolution that
would exceed it throws `LIMIT_EXCEEDED` (a logged 500, nothing written)
instead of consuming unbounded CPU. Under `RULES_V1` no combat ends before
the first attack at 1 000 ms, so an 8-hour cap fits at most **28 800** fights;
a registry test proves every registered rule set stays below the limit, and a
test with a faster rule set proves the limit fires.

Measured (Node 22, development container): ~11 µs per fight; 5 minutes ≈ 120
fights ≈ 8 ms; 1 hour ≈ 3 400 fights ≈ 60 ms; 8 hours ≈ 28 800 fights ≈
300–360 ms, heap growth < 10 MB. A claim is synchronous CPU work on the
request; see Consequences.

### 9. Determinism and seed custody

The seed of a claim is **`characters.offline_seed`**, held by the server and
never sent to a client. Existing rows are backfilled, and new rows start,
from PostgreSQL's strong random source (`gen_random_uuid()`, 244 bits); every
committed claim replaces it with a fresh 256-bit CSPRNG seed from the API
(`OfflineSeedSource`, the same source as combat seeds), and the seed it used is
stored on the claim record.

A per-request seed would be exploitable: a claim that fits no fight writes
nothing, so a client could ask again and again at the edge of a fight until a
lucky draw fitted one more (shorter) fight. With a stored seed that only
changes on commit, asking again returns the same fights; the only lever a
client has is *when* to ask, and whatever it does not claim stays claimable.

Same `(progress, elapsedMs, seed, rulesVersion)` → same result. The record
stores exactly those inputs, and `verifyOfflineRun` re-resolves a stored
claim and compares every summary column; integration tests verify stored
claims from PostgreSQL.

### 10. Atomicity

```
read owned character (+ version, offline seed, claim under key)   — outside tx
resolve in Game Core                                               — outside tx
BEGIN
  UPDATE characters SET level, experience, gold, next_combat_at,
         offline_seed, version = version + 1
   WHERE id AND version = expected AND owner      -- 0 rows → rollback
  INSERT INTO offline_runs (…)                     -- unique (character, key)
COMMIT
```

Rewards, level, the processed boundary, the next seed and the record commit
together or not at all. An integration test forces the INSERT to fail (a CHECK)
and proves the character row is byte-identical afterwards.

### 11. Idempotency: a dedicated record, not the generic table

A claim that fought has a natural result row, `offline_runs`, unique on
`(character_id, idempotency_key)` — the combat pattern (ADR-019 §6). A retry
of a key that committed is answered **from the stored summary, without
re-simulating** (a repeated key costs one read, so replaying 8-hour claims
cannot be used to burn CPU); `character` in that answer is the character's
current state. A key whose first attempt collected nothing is not bound to
anything, because nothing was written; its retry simply claims again under
the same rules.

The generic idempotency table (docs/DATABASE.md) is **still not introduced**:
the smallest correct design is the dedicated record, which future systems do
not need to share. It remains PLANNED for commands without a natural result
row.

### 12. Concurrency

The claim commits through the shared `characters.version`, like combat and
stage selection. Of a claim, a combat, a selection and another claim racing
on one character, exactly one write matches the version; the others write
nothing. A claim that loses re-reads and re-resolves (at most 3 attempts,
then `409 CONCURRENT_UPDATE`): after a winning claim or combat there is
nothing left to collect, after a winning selection it claims against the new
state, and a retry of the same key finds the winner's record and replays it.
No lock, no process-local state; tested with 100 concurrent keys across two
API instances (exactly one claim).

### 13. Interaction with `next_combat_at` and online auto-battle

- After a claim, `next_combat_at = processedUntil ≤ now`: the first online
  combat may start **immediately**, with no artificial wait and no instant
  duplicate (it starts at or after the boundary and moves it).
- A combat in progress (`next_combat_at > now`) leaves no idle time; a claim
  then collects nothing.
- Online auto-battle (ADR-022) is unchanged on the server. In the web client
  the loop waits while a claim is due or in flight. After the page was hidden,
  the claim runs first, then the loop resumes with one fight — never a local
  catch-up. If the network drops during auto-battle, the time without fights
  is idle time; on reconnect the claim converts it (if at least a minute),
  and the next online fight starts after it. The two never overlap because
  both move the same boundary under the same version check.

### 14. Record strategy: one summarised row per claim, not per fight

`offline_runs` stores the replay inputs and the audited summary (fights,
wins, losses, levels gained, reward totals, target, time window). Offline
fights are **not** written to `combat_runs`: an 8-hour claim would add up to
28 800 rows per player per day of absence, and determinism regenerates every
fight from the stored inputs. `combat_runs` keeps its meaning — one row per
online combat — unchanged. Rows are written only for claims that fought; a
claim with nothing to collect writes nothing.

## Consequences

- The client cannot create, stretch, replay or accelerate offline time: it
  sends no time, the server's clock and boundary decide, retries replay, and
  concurrent claims serialise on the version.
- Offline progression cannot break a progression barrier or move a ranking
  value (`highest_stage_cleared`, Phase 10): it never fights an uncleared
  stage and never writes a stage column.
- A claim is CPU work on the request: up to ~0.35 s for a full 8-hour claim
  under rules v1. Many concurrent first claims for one character each
  simulate before the first commits; general request rate limiting (PLANNED,
  docs/SECURITY.md) is the control for that amplification. If measured load
  demands it, the resolution can be chunked or moved to the worker without a
  rule change.
- Offline fights are spaced by combat time only, so offline farming earns at
  the pure pacing-gate rate, slightly faster per hour than online auto-battle
  (which adds the 1.2 s result reveal and a round trip) on the same stage —
  but it farms only proven stages. **Owner decision** whether an offline
  efficiency factor is wanted; none is implemented.
- Idle time before an online fight is forfeited. The web client claims before
  fighting, so this only affects a player who fights from another client that
  does not claim first.
- Offline gold is added fight by fight exactly as online (18-digit HugeNumber
  rounding); the reward totals on the record are the exact sums of the
  per-fight rewards.
- One new column on `characters`, one new table, one new endpoint and
  contract. No new error code, no worker, no Redis.

## Alternatives Considered

**A separate `last_processed_at` column.** Rejected: it would equal
`next_combat_at` after every write that moves either, doubling the source of
truth for no new information (§3).

**A worker or scheduler that simulates idle players.** Rejected: forbidden by
docs/ARCHITECTURE.md ("never run a permanent simulation loop") and pointless
work for players who never return.

**Claim on every player-state read.** Rejected: a GET would write, and the
client would lose the explicit, retryable, idempotent command.

**A fresh CSPRNG seed per request.** Rejected: re-rollable through zero-fight
answers (§9).

**Closed-form or per-hour rewards.** Rejected: a second, offline-only game
whose balance drifts from real combat; it could not respect losses and
level-ups.

**Aggregating runs of identical fights.** Deferred: correct per-fight
simulation of the maximum claim costs ~0.35 s; aggregation would need proofs
of HugeNumber rounding equivalence.

**One `combat_runs` row per offline fight.** Rejected: up to 28 800 rows per
claim (§14).

**The generic idempotency table.** Deferred again: the dedicated record is
the natural result row (§11).

**Offline climbing or boss attempts.** Rejected by the product rule: barriers
are broken by the player (§6).

**Forfeiting the remainder of the last fight at each claim.** Rejected: calling
the endpoint would then cost time. The remainder stays claimable.

**Bumping `GAME_RULES_VERSION` to 2 for the offline block.** Rejected, as in
ADR-021: the block changes no persisted outcome.
