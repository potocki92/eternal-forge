# ADR-021 — Stage selection and farming

## Status

Accepted — 2026-09-23. Proposed with Phase 4 PR 4.1; accepted when PR #9 was
merged and the user started PR 4.2.

## Date

2026-09-23

## Context

ADR-020 separated the stage the hero fights on (`current`) from the records
(`highestReached`, `highestCleared`), and named stage selection and farming as
the first things to build on it. Phase 3 always pushed forward: a victory
moved the hero on, a defeat moved it back (ADR-019 §3). The player could not
choose a stage or stay on one.

Phase 4 starts with that choice, because auto-battle and offline progression
(later PRs) must know *what the hero does after a victory* before they can
repeat it unattended. The questions:

1. What is the new persistent state, and does it duplicate anything?
2. Who decides whether a stage may be chosen?
3. What does a farm victory or defeat do to the position and the records?
4. How does a selection interact with the combat transaction under
   concurrency and retries?
5. Does `GAME_RULES_VERSION` change?

## Decision

### 1. One new value: the stage mode

`current_stage` already *is* the selected combat position (ADR-020 §1). No
second "selected stage" column is added. The only new state is what a
victory does to it:

| Mode       | Player-facing text  | After a win                 | After a loss                             |
| ---------- | ------------------- | --------------------------- | ---------------------------------------- |
| `PROGRESS` | "Continue climbing" | move on to `current + 1`    | fall back `stagesLostOnDefeat` (ADR-020) |
| `FARM`     | "Stay on this stage" | stay on `current`          | stay on `current`                        |

It is the Game Core type `StageMode`, the PostgreSQL enum `stage_mode` on
`characters` (default `PROGRESS`) and `progression.stageMode` on the wire.

### 2. The records move the same way in every mode

A win clears the stage fought and unlocks the next one; a loss clears and
unlocks nothing. This holds in both modes, in the single
`advanceStageProgress`. Farming stage 99 below an unbeaten stage-100 boss
therefore leaves `99 / 100 / 99` forever: stage 100 is never cleared by
farming, because it is never fought. A victory is still a victory: farming a
stage that is reached but not yet cleared (for example the frontier boss) and
winning clears it, exactly as climbing would. That is a proven clear, not a
faked one, and it is recorded in `combat_runs` like any other.

Farming uses the same enemy, combat, rewards and level rule as climbing. There
is no farm-specific formula; the golden farm vector proves the combat and the
rewards are byte-identical to a `PROGRESS` attempt on the same input.

### 3. Selection is a Game Core rule, validated on the server

`selectStage(progress, selection)` in Game Core:

- `{ mode: 'PROGRESS' }` returns the hero to its frontier: `current =
  highestReached`. The client sends no stage.
- `{ mode: 'FARM', stage }` places the hero on `stage` if `1 ≤ stage ≤
  highestReached`, else throws `STAGE_LOCKED`. Nothing is clamped.
- Only `current` moves. The records are never written by a selection.

The bound is `highestReached`, not `highestCleared`: the player may stay on the
frontier stage to retry a boss. The comparison is exact `bigint` arithmetic,
so `2^53 + 4` stays locked when the frontier is `2^53 + 3`.

### 4. API

`PUT /player/characters/:characterId/stage-selection` with a strict body
`{ "mode": "PROGRESS" }` or `{ "mode": "FARM", "stage": "<canonical decimal>" }`.
`200` returns `{ character, progression, serverTime }`. Errors:
`400 VALIDATION_FAILED`, `401`, `404 NOT_FOUND` (missing *or* someone else's),
`409 STAGE_LOCKED`, `409 CONCURRENT_UPDATE`.

`PUT` because the request sets a value: repeating it leaves the same state.
It therefore needs no idempotency key. A request that changes nothing writes
nothing.

### 5. Concurrency: the combat version, reused

`SelectStageUseCase` reads the owned character and its `version`, runs
`selectStage`, and writes `current_stage`, `stage_mode` and `version + 1` in
one `UPDATE … WHERE id AND version = expected AND owner`. Consequences:

- A combat simulated from the old state cannot commit after a selection: its
  own version check fails and it writes nothing (ADR-019 §5).
- A selection that loses to a combat re-reads and re-validates, up to three
  attempts, then answers `409 CONCURRENT_UPDATE`. The records only grow, so a
  stage that was unlocked stays unlocked on re-validation.
- No lock, no in-memory state; any number of API instances.

The combat transaction itself is unchanged. It reads the mode from the same
owner-scoped row it already reads, never from the request.

### 6. Replay

`combat_runs.stage_mode` records the mode a combat was fought in, next to the
records before it. A replay resolves under the stored mode, so a combat
replayed after the player switched modes reproduces its original transition.
Existing rows are backfilled `PROGRESS`, the only behaviour that existed. The
column has no default afterwards, so every new row states its mode.

### 7. Rules version

`GAME_RULES_VERSION` stays **1**. `resolveStageAttempt` gains `mode` as an
explicit input; it is not echoed into the result. Every persisted result was
produced in `PROGRESS` mode and replays identically: the Phase 3 golden
fingerprints are unchanged. `FARM` is a new input, not a changed rule. From
this ADR on, the `FARM` transition is part of rules v1 and is frozen with it;
changing it later needs rules v2.

### 8. Offline progression and auto-battle attach here

Both will run `resolveStageAttempt` with the persisted `stage_mode`. Farming
offline therefore cannot clear a boss it does not fight. Whether an offline
run may *climb* (fight bosses unattended) is deliberately left to the offline
PR; this ADR adds no offline behaviour.

## Consequences

- The player can farm any reached stage and return to the frontier with one
  action; both survive refresh, relogin, API restarts and device changes
  because they are server state.
- The `highest_stage_cleared` ranking value (Phase 10) cannot be raised by
  farming below it.
- Selection and combat share one concurrency token; a selection may make a
  concurrent combat request fail with `409`, which the client resolves by
  re-reading state.
- One more enum column on each of `characters` and `combat_runs`.
- A combat that loses its race to a selection is reported as
  `COMBAT_NOT_READY` (the existing loser path of ADR-019). Accurate enough —
  nothing was written and the client re-reads — but not a precise reason.

## Alternatives Considered

**A separate `selected_stage` column.** Rejected: `current_stage` already is
the position the next combat uses; two columns would need a rule for which one
wins.

**Farm bound `stage ≤ highestCleared`.** Rejected: it forbids "stay and retry
the boss", and `highestCleared` is `NULL` for migrated characters that have
reached stages without a recorded clear.

**FARM defeat falls back like PROGRESS.** Rejected: it moves the chosen farm
stage, which contradicts the mode's promise. The deadlock argument of
ADR-020 §3 does not apply: the player can switch mode at any time.

**A farm win does not clear or unlock.** Rejected: it would make the same
proven victory count differently depending on a UI toggle, and hide real
clears from the ranking.

**Idempotency key on selection.** Rejected: setting a value is idempotent by
nature.

**Several endpoints (`/farm`, `/progress`).** Rejected: one command with a
discriminated body is simpler and validated by one shared schema.

**Bump `GAME_RULES_VERSION`.** Rejected: no persisted outcome changes; the new
mode is recorded per combat.
