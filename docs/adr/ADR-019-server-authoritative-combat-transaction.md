# ADR-019 — The server-authoritative combat transaction

## Status

Accepted — 2026-09-23 (Phase 3)

## Date

2026-09-23

## Context

Phase 3 turns the headless simulation of Phase 1 and the identity of Phase 2
into the first persistent gameplay loop:

```
authenticated player → current stage → enemy → combat → win/loss
→ rewards, experience, level, stage → persisted → shown → repeat
```

Every step that decides an outcome is gameplay truth, so it must be decided on
the server by Game Core and written atomically (ADR-003, ADR-005). The loop is
also the first operation a hostile or merely unreliable client can repeat,
race or retry, and the first to persist a simulation result.

Five questions have to be answered together because each constrains the
others:

1. What a client may send, and what it may never send.
2. Where the seed comes from.
3. How concurrent and repeated requests are prevented from duplicating
   rewards or skipping stages.
4. What is persisted, and what is derived again on demand.
5. How the same design carries offline progression (Phase 4) without a rewrite.

One gameplay question surfaced while designing the loop and is decided here
because the loop does not work without an answer. Phase 3 has no progression
source except combat. If a lost combat simply keeps the character on the same
stage, a player who loses a stage can never gain another point of experience.
They are stuck forever. A simulation of 2 000 consecutive fights under
`RULES_V1` confirms this. It stalls at the stage-10 boss with 1 991 losses.

## Decision

### 1. What starts a combat

`POST /player/characters/:characterId/combats` with an `Idempotency-Key`
header. There is no request body.

| Client may send                        | Client may never send                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| the character id (path), as a *target* | stage, level, experience, gold, enemy, seed, damage,        |
| an idempotency key (header, UUID)      | outcome, rewards, player/profile/user id, rules version     |

The character id selects one of the caller's characters. Identity comes only
from the verified access token (ADR-016). The character is loaded with the
owner in the `WHERE` clause. Someone else's character is indistinguishable
from a missing one: both return `404 NOT_FOUND`.

`201 Created` reports a new combat. `200 OK` reports the replay of a combat
already resolved under the same key.

### 2. The seed

The API generates a fresh seed per combat from the operating system's CSPRNG:
256 random bits, base64url-encoded to 43 characters. The generator sits behind
an application port (`CombatSeedSource`), so tests can inject fixed seeds.

- The client never chooses, submits or influences a seed.
- The seed does not exist before the request that uses it. The result is
  committed before the response is sent, so a client cannot discard an
  unfavourable result and try again (commit, then reveal).
- The seed is persisted with the combat for audit and replay. It is not
  returned to the client, which has no use for it.
- xoshiro128\*\* remains the combat generator (ADR-015). Unpredictability comes
  from the CSPRNG seed, not from the simulation generator.

### 3. Game Core is the single authority

A new pure Game Core function, `resolveStageAttempt`, performs the entire
gameplay step:

```
resolveStageAttempt({ progress: { level, experience, gold, stage }, seed, rulesVersion })
  → stage + kind, enemy, character stats, CombatResult,
    rewards, levels gained, resulting progress
```

- **Enemy:** `createEnemyForStage(stage)`. The boss classification comes from
  the rule set.
- **Combat:** `simulateCombat` with the character's level-derived stats.
- **Win:** the stage rewards are granted. Experience is applied through the
  level rule. The stage advances by exactly one.
- **Loss:** nothing is granted. The character falls back
  `progression.stagesLostOnDefeat` stages, 1 under `RULES_V1`, but never below
  stage 1. It fights the next stage again from there.
- **Level rule:** the experience needed to go from level `L` to `L + 1` is
  `floor(base × growth^(L − 1))`, `10 × 1.10^(L − 1)` under `RULES_V1`.
  Experience is stored as progress *within* the current level. A level-up
  subtracts the requirement and repeats. One gain is bounded to 1 000 levels
  so that one call's work stays bounded. Any excess stays banked and is
  consumed by the next gain.

Neither the API nor the web application duplicates any of these rules. The
API persists what Game Core returned. The client displays what the API
returned.

**Why a defeat falls back a stage.** Without the fallback the loop deadlocks,
as the Context shows. With it, a wall becomes a farm. The player repeats the
previous stage for rewards until their level beats the wall. This is the
standard idle-RPG loop, and it matches the design intent: "Progression wall →
build optimization → further progression" (docs/MASTER_PLAN.md). Under
`RULES_V1` a simulated player reaches stage 10 after about one minute of
combat time. They farm for about eight minutes before beating the first boss,
and reach stage 100 after about four hours. The value is data
(`stagesLostOnDefeat`), so a later rule set can change it without an engine
change. A player-controlled "stay and farm" toggle is FUTURE.

### 4. Pacing: combat takes the time it takes

A resolved combat occupies the character for its simulated duration. The
transaction sets `characters.next_combat_at = resolvedAt + durationMs`, using
the server clock. A request earlier than that is refused with
`409 COMBAT_NOT_READY` and a `Retry-After` header.

Without this gate, progression speed would be bounded only by how fast a
script can send HTTP requests. In an idle game, time is the resource, so that
would be the most valuable exploit available. The client plays the animation
for exactly `durationMs` and enables the next fight when the server says it may.

### 5. Concurrency: optimistic, per character

`characters.version` (`bigint`) is incremented by every progression write. A
combat:

1. reads the owned character and its `version`, outside any transaction;
2. checks the pacing gate;
3. runs Game Core, also outside the transaction;
4. commits one short transaction:

   ```sql
   UPDATE characters SET <new progress>, version = version + 1, next_combat_at = …
    WHERE id = $1 AND version = $expected;          -- 0 rows → stale
   INSERT INTO combat_runs (…);                      -- unique (character_id, idempotency_key)
   ```

Under READ COMMITTED, a second writer blocks on the row lock. PostgreSQL then
re-evaluates its `WHERE` against the committed row, finds a different
`version` and updates nothing. That transaction rolls back and inserts
nothing. So 20 simultaneous requests for a character on stage 9 produce one
combat, one reward and one stage change. The other 19 are either replays of
that combat (same key) or `409 COMBAT_NOT_READY` (different keys).

Why optimistic rather than `SELECT … FOR UPDATE`:

- The simulation runs outside the transaction, so the row lock is held for two
  statements, not for a simulation.
- Losers fail fast and never queue behind a lock. With the pacing gate, a
  loser could not have fought anyway.
- It is expressible in Prisma without raw SQL, and it works identically across
  any number of API instances. An in-process mutex would not.

Isolation stays at PostgreSQL's default, READ COMMITTED. SERIALIZABLE would
add retry handling without protecting anything the version check does not.

### 6. Idempotency

The idempotency key is a client-generated UUID, one per player intent ("fight
now"). The client reuses it for every retry of that intent. It carries no
gameplay information.

- The key is stored on the combat record: `UNIQUE (character_id,
  idempotency_key)`. A request whose key already exists for that character
  replays that combat and changes nothing.
- A retry racing its own original is caught either by the version check or
  by the unique constraint. In both cases it re-reads the key and replays the
  winner.
- A missing or malformed key is `400 VALIDATION_FAILED`.
- A combat is its own natural result record. The generic idempotency table in
  docs/DATABASE.md, for operations that produce no result row of their own,
  is still PLANNED for Phase 4. It will not replace this constraint.

**Replay without stored logs.** A replay re-runs `resolveStageAttempt` from the
stored inputs. These are the rules version, the seed, and the level,
experience, gold and stage before the fight. Determinism reproduces the event
timeline exactly. The recomputed outcome, duration and rewards are compared
with the stored summary. A mismatch is a defect: it is logged and answered
with a 500, never with a different result. Recorded rule sets stay registered
(ADR-015), so a replay after a balance patch still resolves under the rules
that applied.

### 7. What is persisted

Source state on `characters`, new columns:

| Column                               | Type                  | Rule                                     |
| ------------------------------------ | --------------------- | ---------------------------------------- |
| `experience_coef`, `experience_exp`  | `bigint`, `integer`   | HugeNumber pair, non-negative (ADR-013)  |
| `gold_coef`, `gold_exp`              | `bigint`, `integer`   | HugeNumber pair, non-negative (ADR-013)  |
| `next_combat_at`                     | `timestamptz(3)`      | pacing gate, server time                 |
| `version`                            | `bigint`              | optimistic concurrency token, ≥ 0        |

`level` (`integer`) and `stage` (`bigint`, ADR-018) already exist. Combat
stats, the experience requirement and the next enemy are derived by Game Core
and never stored.

`combat_runs`, one row per resolved combat:

| Group        | Columns                                                                |
| ------------ | ---------------------------------------------------------------------- |
| identity     | `id`, `character_id` (FK, cascade), `idempotency_key`, `created_at`    |
| replay input | `rules_version`, `seed`, `stage`, `character_level`, experience and gold before (pairs) |
| audit output | `outcome`, `end_reason`, `duration_ms`, reward gold and experience (pairs) |

The event log is **not** stored. Under `RULES_V1` it holds up to 54 hits.
Under the rules' own caps it could hold up to 600 hits, for every combat of
every player. The seed and inputs regenerate it exactly. The summary columns
record what was granted and why, so the table is also the economy's credit
ledger for Phase 3. Every gold and experience gain in the game is a row here.

`combat_runs` records `rules_version` as docs/DATABASE.md requires for any
persisted simulation result. It gets Row Level Security with no policies, like
the Phase 2 tables.

### 8. What the client receives

The shared contract `CombatResponse` carries:

- `combat`: id, stage number and kind (from Game Core), enemy archetype and
  stats, hero stats, outcome, end reason, duration, the ordered event timeline
  (time, attacker, critical, damage, target health), rewards, levels gained,
  resolution time;
- `before` and `after`: level, experience, experience to next level, gold and
  stage;
- `character`: the resulting character state, and `progression`: the next
  encounter (stage, kind, enemy) and `nextCombatAt`;
- `serverTime`.

Large quantities travel as canonical HugeNumber strings. Stages travel as
canonical decimal strings (ADR-018). The contract never contains the seed, the
owner's auth id or any internal column.

`GET /player/state` gains the same `progression` block. The client can then
show the upcoming enemy, the boss treatment, the experience bar and the
pacing gate without computing anything.

### 9. Rules version

The progression rules (`progression.experienceToLevelBase`,
`experienceToLevelGrowth`, `stagesLostOnDefeat`) are added to `RULES_V1` in
place, and `GAME_RULES_VERSION` stays **1**:

- No simulation result under version 1 has been persisted before this phase.
  Phase 2 stores identity, not results.
- The change adds rules. It does not alter any existing outcome. The Phase 1
  golden fingerprints and transcript pass unmodified.

From the first persisted combat onwards, `RULES_V1` is frozen history. Any
later balance change is a new rule set under a new version (ADR-015).

### 10. Offline progression (Phase 4) attaches here

- `next_combat_at` is the point up to which the character's time has been
  consumed. Offline progress resolves attempts from there to the server's
  "now", within a cap, through the same `resolveStageAttempt`. Stages are
  derived by the same seed rules, for example `deriveSeed(offlineSeed, n)`.
- It commits through the same conditional `UPDATE … WHERE version = …`, so an
  online fight and an offline claim cannot both apply.
- Offline progress needs an aggregate record, because one claim covers many
  fights. That record and the generic idempotency table are Phase 4 designs.

## Implementation notes (2026-09-23)

Two findings during implementation refine the decision above. They do not
change it.

1. **One clock for the pacing gate.** A new character's `next_combat_at` was
   first left to the column default, the database's `now()`, while the gate
   compares against the API's clock. Any skew between the two would block a
   new character's first fight. Provisioning now writes `next_combat_at`
   from the API clock, and every value the gate reads comes from that single
   source. The column default remains only to backfill rows that existed
   before the migration.
2. **An encounter can be undescribable.** Every stage from 1 to 2^63 − 1 is
   valid (ADR-018). Under `RULES_V1`, however, enemy scaling overflows
   `HugeNumber` around stage 4·10^10. Deriving the encounter for
   `GET /player/state` there would turn a valid read into a 500.
   `describeProgress` therefore returns `encounter: null` when the rule set
   cannot scale an enemy that deep. The contract carries it as `null`, and the
   web app shows "no enemy can be found" and disables the fight. A combat
   attempted there fails with a 500 and writes nothing, and a test pins that
   behaviour. No such state is reachable in play.

## Amendment — ADR-020 (2026-09-23)

The final audit of PR #6 split the single `stage` into the current stage and
two records (ADR-020). The transaction above is unchanged: the same
owner-scoped read, the same version-conditional two-statement commit and the
same idempotency key. What changed:

- `characters.stage` is now `current_stage`, next to `highest_stage_reached`
  and `highest_stage_cleared`. `combat_runs.stage` remains the stage fought and
  gains the records before the combat as replay input.
- A win or loss moves `current` exactly as described in §3. The records never
  decrease.
- Implementation note 2 no longer holds: a combat on a stage the rule set
  cannot scale is now `409 STAGE_NOT_PLAYABLE`, not a 500. It still writes
  nothing.

The text above is kept as it was decided.

## Consequences

- A combat cannot be forged, replayed for a second reward, raced into a double
  advance, re-rolled or sped up by a client. Each property is covered by a
  test against PostgreSQL.
- A new combat costs four statements. First comes one owner-scoped read of
  the character and of any combat already recorded under the key; Prisma
  issues it as two `SELECT`s. Then an `UPDATE` and an `INSERT` run in one
  transaction. The unique index `(character_id, idempotency_key)` serves the
  key lookup. A replay costs the read alone.
- The API now calls Game Core on every combat and on every player-state read.
  At about 200 k combats/s (Phase 1 benchmark), this is not a cost concern.
- Players wait for combat time. This is the intended pace, and the rule set
  owns it.
- A replay depends on the recorded rule set staying registered. Removing a
  rule set is a data-retention decision.
- `packages/contracts` now depends on `packages/game-core` for
  `HugeNumber.isCanonical`, the edge ADR-013 approved. The HugeNumber wire
  format is defined once. `stageNumberSchema` keeps its own definition and the
  cross-check test from ADR-018.
- `RULES_V1` is frozen from now on.

## Alternatives Considered

**Stay on the stage after a defeat.** Rejected. It deadlocks the only
progression loop Phase 3 has (see Context).

**Let the client choose the stage to farm.** A server-validated "farm stage N ≤
highest cleared" is a legitimate future feature. It is rejected for Phase 3:
the stage is server-determined by the task definition, and the fallback rule
gives the same loop without client input.

**Pessimistic locking (`SELECT … FOR UPDATE`).** Correct too. Rejected because
it holds the lock across the simulation, queues losers instead of failing them
fast, and needs raw SQL.

**SERIALIZABLE isolation.** Rejected. It adds serialization-failure retries and
protects nothing the version check does not.

**An in-memory or Redis lock.** In-memory is wrong with more than one API
instance. Redis would make an ephemeral store part of an economic invariant
(ADR-006). PostgreSQL already provides the guarantee.

**A server-issued combat ticket (`POST /combat-intents`, then resolve).**
Rejected. It costs an extra round trip and a table for pending intents. A
client-generated idempotency key gives the same retry safety with a single
request, and the key carries no gameplay input.

**A generic idempotency table storing the response body.** Rejected for
combat. The response would be a second copy of data that the combat row and
determinism already reproduce, and it would store the event log this ADR
avoids storing.

**Storing the full event log (JSONB).** Rejected. It is the largest part of
every row, and determinism regenerates it exactly from inputs that must be
stored anyway.

**No pacing gate, rate limiting only.** Rejected. A rate limit bounds requests,
not game time. A script at the limit would still progress far faster than the
rules intend.

**Bumping `GAME_RULES_VERSION` to 2 for the progression rules.** Rejected.
Nothing produced under version 1 has been persisted, and no existing outcome
changes. A bump would leave a version 1 that was never used.
