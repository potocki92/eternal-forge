# ADR-020 — Stage progression model: current stage and records

## Status

Accepted — 2026-09-23 (Phase 3, final audit of PR #6)

## Date

2026-09-23

## Context

ADR-019 persisted progression as a single `characters.stage`. The one column
had two meanings:

1. **Where the hero fights next.** The loop reads it to choose the enemy.
2. **How far the hero has come.** The player reads it as a record, and a future
   ranking would read it as a score.

The two meanings diverge at the first wall. A boss defeat on stage 10 sends the
hero back to stage 9 to farm (ADR-019 §3). The column then said 9, and the fact
that the hero had reached stage 10 and cleared stage 9 existed only in the
combat history. Everything planned after Phase 3 needs the distinction:

- **Rankings (Phase 10)** must rank how far a player has *proven* they can
  go. They must not rank where the player currently stands. Farming must never
  lower a rank.
- **Stage selection, a "stay and farm" toggle and auto modes (FUTURE)** need a
  bound on which stages are unlocked.
- **Offline progression (Phase 4)** simulates from the current position. It
  must not erase the records while it farms.

The final audit of PR #6 asked for the distinction before Phase 3 is merged.
Only DEV and test data exist, so this is the cheapest moment to change the
schema.

## Decision

### 1. Three values, one value object

Game Core owns `StageProgress`:

| Field            | Meaning                                                          | Moves          |
| ---------------- | ---------------------------------------------------------------- | -------------- |
| `current`        | the stage the next combat is fought on (pushed or farmed)        | up and down    |
| `highestReached` | the highest stage ever unlocked                                  | never down     |
| `highestCleared` | the highest stage ever defeated; `null` until the first victory | never down     |

All three are exact `StageNumber`s (ADR-018), never JavaScript numbers.
Before the first victory the record is `null`, not a "stage 0". Stage 0 is not
a stage, and `null` already says "nothing yet" in the database, on the wire and
in the UI.

Invariants, enforced by `createStageProgress` in Game Core and by CHECK
constraints in PostgreSQL:

- `1 ≤ current ≤ highestReached`
- `highestCleared` is `null` or `1 ≤ highestCleared ≤ highestReached`

`highestReached ≤ highestCleared + 1` is deliberately **not** an invariant.
Characters migrated from Phase 2 can stand on stage 7 with nothing proven
cleared (§5). A future rule, such as a skip-ahead reward, may also unlock a
stage without clearing the one before it.

### 2. The transition is a Game Core rule

`advanceStageProgress(progress, outcome, rules.progression)`:

- **Win on `current`.** `current` is cleared: `highestCleared = max(highestCleared,
  current)`. The next stage is unlocked: `highestReached = max(highestReached,
  current + 1)`. The hero moves on to `current + 1`.
- **Loss.** Nothing is cleared or unlocked. The hero falls back
  `stagesLostOnDefeat` stages (1 under `RULES_V1`), never below 1. The records
  are untouched.

`resolveStageAttempt` calls it, so the API cannot compute a transition of its
own. The API persists `after.stages` exactly as returned.

Test matrix (`current / highestReached / highestCleared`), in
`stage-progress.test.ts`:

| Before       | Outcome | After        |
| ------------ | ------- | ------------ |
| `1 / 1 / –`  | WIN     | `2 / 2 / 1`  |
| `8 / 8 / 7`  | WIN     | `9 / 9 / 8`  |
| `9 / 9 / 8`  | WIN     | `10 / 10 / 9`|
| `10 / 10 / 9`| LOSS    | `9 / 10 / 9` |
| `10 / 10 / 9`| WIN     | `11 / 11 / 10`|
| `9 / 10 / 9` | WIN     | `10 / 10 / 9` (farming) |
| `1 / 1 / –`  | LOSS    | `1 / 1 / –`  |

### 3. Normal defeats fall back like boss defeats

The audit asked whether a defeat on a *regular* stage should also fall back.
There were two options:

- **Uniform fallback.** Any defeat moves back `stagesLostOnDefeat` stages.
- **Retry on regular stages.** Only a boss defeat moves back.

We chose **uniform fallback**, for three reasons:

1. **Deadlock.** Under "retry", a hero that loses a regular stage stays on it.
   Phase 3 has no stage selection and no other source of experience, so
   nothing changes until the hero wins, and it may never win. That is exactly
   the deadlock the fallback exists to prevent (ADR-019 §3). Whether it can
   happen depends on balance, and balance will change.
2. **It is rare in practice.** In 3 000 simulated push-and-farm fights under
   `RULES_V1`, all 1 421 losses happened on boss stages and none on a regular
   stage. The uniform rule costs nothing today and removes a whole class of
   future stuck states.
3. **It stays data.** `stagesLostOnDefeat = 0` means "retry", and a test covers
   it. A later rule set can pick a different behaviour, or make it depend on
   the stage kind, without an engine change.

With stage selection (FUTURE) the player will be able to choose to retry or
farm. Until then, the server's rule decides.

### 4. Persistence

`characters`:

- `stage` is renamed to `current_stage`. It keeps its `bigint` type and its
  CHECK, which is renamed to `characters_current_stage_check`.
- `highest_stage_reached bigint NOT NULL DEFAULT 1`.
- `highest_stage_cleared bigint NULL`.
- CHECKs: reached ≥ 1; cleared is `NULL` or ≥ 1; `current_stage ≤ reached`;
  cleared is `NULL` or ≤ reached.

`combat_runs` keeps `stage` as **the stage actually fought** (`before.current`)
and adds `highest_stage_reached_before bigint NOT NULL` and
`highest_stage_cleared_before bigint NULL`. The replay inputs are then the
complete `before` progress, and re-simulating a stored run reproduces the whole
transition, records included. CHECKs: `stage ≤ reached_before`; cleared_before
is `NULL` or between 1 and reached_before.

The combat commit stays one conditional transaction (ADR-019 §5). The three
columns are written by the same `UPDATE … WHERE version = expected`, so
optimistic concurrency and idempotency are unchanged. Twenty-five retries of
one intent move the records exactly once, and 25 concurrent intents produce
one transition. Both are tested against PostgreSQL.

### 5. Backfill never claims a clear that nothing proves

Migration `20260923090000_stage_progression`:

- `highest_stage_cleared` = the highest stage with a recorded `WIN` in
  `combat_runs`, else `NULL`.
- `highest_stage_reached` = the greatest of `current_stage`, the highest stage
  fought, and the highest stage won + 1.
- Each existing `combat_runs` row gets the records its own earlier runs prove,
  using a window over `(created_at, id)` that ends *before* the row.

A Phase 2 character on stage 7 with no combats therefore becomes `7 / 7 / –`.
The stage has been reached, but nothing is proven cleared. The migration was
verified on an empty database, on a Phase 2 database with no combats and on a
Phase 3 database with a win streak and a boss loss. In all three cases
`prisma migrate diff --exit-code` reports no drift.

### 6. Contract

- `progression` (in `PlayerStateResponse`, `CombatResponse` and — new —
  `CharacterResponse`) carries `currentStage`, `highestStageReached` and
  `highestStageCleared` (`null` allowed). Each is a canonical decimal string.
  The invariants are re-checked on parse with exact `BigInt` comparisons.
- The `before` and `after` snapshots of a combat carry the same three fields.
- `CharacterDto` no longer carries `stage`. Stage progress lives only in
  `progression`, so there is one place to read it. This is a **breaking
  change** for API clients. `apps/web` is updated in the same change.
- `combat.stage` stays the stage fought, classified by Game Core.

### 7. A valid stage the rules cannot scale: `409 STAGE_NOT_PLAYABLE`

Under `RULES_V1`, enemy scaling overflows `HugeNumber` around stage 4·10^10
(ADR-019, implementation note 2). A combat there used to fail with a 500. The
use case now checks the encounter before it draws a seed. When the rule set
cannot describe an enemy, it returns `stage-not-playable`, and the controller
maps that to `409 STAGE_NOT_PLAYABLE` with no `Retry-After`. Nothing is written
and no seed is spent. The stage number is never clamped or truncated.

### 8. Rules version

`GAME_RULES_VERSION` stays **1**. The change adds state to the outcome of a
stage attempt. It does not change any combat or reward: the golden combat and
reward fingerprints recorded before the refactor are pinned and unchanged. No
production result exists under rules v1. `RULES_V1` becomes **immutable once
PR #6 is merged**. Any later balance or transition change needs rules v2.

### 9. Rankings (documented, not implemented)

The Highest Stage ranking (Phase 10) will rank `highest_stage_cleared`. It is
monotonic, proven by a recorded win, and unaffected by farming. A `NULL`
means the player is not ranked yet. Ties are broken by the time the record was
set, which `combat_runs` already provides.

## Consequences

- A boss defeat no longer erases how far a player has come. The HUD shows the
  current stage and, separately, the best stage cleared.
- Stage selection, farming modes and offline progression can build on
  `current` without touching the records.
- One more pair of columns in `combat_runs` makes every replay reproduce the
  complete transition.
- Clients that read `character.stage` must read `progression.currentStage`.
- Game Core, the database and the contract each enforce the invariants, so an
  inconsistent state is rejected at every layer rather than repaired.

## Alternatives Considered

**Keep one column and derive the records from `combat_runs` on read.**
Rejected. Every player-state read and every future ranking query would need
an aggregate over the whole history. Records are part of the character's
state, so they belong on the character row.

**Use `highestStageCleared = 0` instead of `NULL`.** Rejected. Stage 0 does not
exist (ADR-018). It would need a special case in `StageNumber`, in the CHECKs
and in every display.

**Store only `highestReached` and derive cleared as `highestReached − 1`.**
Rejected. It holds only while every unlock comes from clearing the stage
before it. Migrated data already breaks it (§5), and a future skip-ahead
mechanic would too.

**Retry on a regular-stage defeat.** Rejected for now (§3). It remains
available as rule data.

**Bump `GAME_RULES_VERSION` to 2.** Rejected. No persisted production result
exists under v1, and no combat or reward outcome changed. A bump would only
add a registry entry that nothing uses.
