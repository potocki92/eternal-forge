# ADR-018 — StageNumber: an exact integer for stage progression

## Status

Accepted

## Date

2026-09-23

## Context

The Phase 2 external audit found a contradiction in how stages are represented.

- `docs/GAME_DESIGN.md` calls stage progression effectively unlimited, and
  ADR-017 stores `characters.stage` as PostgreSQL `bigint` so the schema has
  no small ceiling.
- Everything above the column used a JavaScript `number`: Game Core's `Stage`,
  the API domain `Character.stage`, and the wire contract, which capped `stage`
  at `Number.MAX_SAFE_INTEGER`. `PrismaPlayerRepository.toSafeInteger()`
  converted the column's `bigint` to a `number` and threw above 2^53 − 1.

The database could therefore hold legal values, from 2^53 up to 2^63 − 1, that
the application could not read. A player at such a stage would get a 500 on
every request. Before Phase 3 persists stage progression, one exact
representation has to run end to end.

`HugeNumber` (ADR-013) is not the answer. It is an 18-significant-digit
approximate magnitude that rounds. A stage is a discrete counter: it needs an
exact successor, exact equality and exact divisibility (boss every 10th stage),
and it must never round.

## Decision

### Value object

Game Core owns `StageNumber` (`packages/game-core/src/stage/stage-number.ts`),
a Value Object for a stage position:

- Internal representation: `bigint`. There is no floating-point anywhere and no
  conversion to a JavaScript `number`.
- Range: `1 … 2^63 − 1` (`STAGE_NUMBER_MAX`), the PostgreSQL `bigint` range
  intersected with the rule `stage ≥ 1`. The upper bound makes "effectively
  unlimited" concrete: every valid value fits the column exactly, and the wire
  form is at most 19 digits.
- Construction:
  - `StageNumber.of(bigint | number)`. A `number` must be a safe integer, so a
    value that has already lost precision can never become a stage.
  - `StageNumber.parse(string)` accepts the canonical decimal form only.
  - Invalid input throws a typed `GameCoreError`: `INVALID_FORMAT`,
    `OUT_OF_RANGE` or `NOT_A_SAFE_INTEGER`. Nothing is clamped or repaired.
- Operations the stage ladder needs, and no others:
  - `compare` and `equals`;
  - `plus(offset)` and `next()`, bounded by the maximum;
  - `isMultipleOf(interval)` for boss stages;
  - `stagesBefore()` (`stage − 1`, a `bigint`), the exponent of per-stage
    scaling;
  - `toBigInt()`, and `toString()`/`toJSON()`, which return the canonical
    decimal string.

It is deliberately not a general integer type. No `minus`, `mul` or `div`
exists until a mechanic needs one.

### Canonical wire form

On the wire, a stage is a JSON **string** holding the canonical decimal form:
`^[1-9][0-9]{0,18}$` and at most `"9223372036854775807"`. A JSON number would
be parsed into a double by every JavaScript client and would silently round
above 2^53.

`packages/contracts` publishes the format as `stageNumberSchema`, together with
`STAGE_NUMBER_WIRE_MAX`. The contracts package stays free of any Game Core
dependency, so the schema checks the bound by string comparison between
equal-length digit strings. A test in `apps/api` ties the two definitions
together. The maximum must be equal, the API's output must satisfy the
contract, and both must reject the same malformed inputs.

### Layers

| Layer                     | Stage type                    | Conversion                                |
| ------------------------- | ----------------------------- | ----------------------------------------- |
| PostgreSQL                | `bigint`, `CHECK (stage >= 1)` | —                                         |
| Prisma adapter            | `bigint` row field            | `StageNumber.of(row.stage)`, `toBigInt()` |
| API domain and port       | `StageNumber`                 | —                                         |
| Presentation mapper       | `string`                      | `stage.toString()`                        |
| Contract (`CharacterDto`) | canonical decimal `string`    | validated by `stageNumberSchema`          |
| Web                       | `string`                      | display only: `Intl.NumberFormat` on `BigInt(stage)` |

The HTTP → Controller → Application → Repository Port → Prisma Repository →
PostgreSQL flow is unchanged. Prisma types still stop at the adapter.
`apps/api` now depends on `@eternal-forge/game-core`, which is the intended
direction: Application and Domain depend on Game Core.

### Game Core

- `Stage.number` is a `StageNumber`. `resolveStage` and `createEnemyForStage`
  take one, and boss classification uses `isMultipleOf`.
- `scaleByStage` computes `growth^(stage − 1)` with a `bigint` exponent.
  `HugeNumber.pow` now accepts `number | bigint` and runs the identical
  least-significant-bit-first square-and-multiply sequence, so every existing
  result is bit-for-bit the same. A stage too deep for a rule set's growth
  fails with `OVERFLOW`, never with a wrong value. Under `RULES_V1` that
  happens around stage 4·10^10, well below 2^53. The representation is
  therefore never the limiting factor.
- `simulateStages` takes `startStage?: StageNumber`. `StageRunResult.startStage`
  is a `StageNumber`, and `highestStageCleared` is `StageNumber | null`: `null`
  when the first stage was lost, because "stage 0" is not a stage.
- Per-stage seeds are `deriveSeed(seed, 'stage', stage.toString())`. That is
  byte-identical to the label a numeric stage produced, so every seed is
  unchanged.
- `GAME_RULES_VERSION` is **not** bumped. No outcome changed. The golden
  fingerprints recorded under Phase 1 still pass. They hash stage numbers as JSON
  numbers, their original form, which is an exact projection for the small
  stages involved.

### What this ADR does not change

- The database schema. The column was already `bigint NOT NULL DEFAULT 1
  CHECK (stage >= 1)`, so no migration is needed. PostgreSQL itself rejects
  values outside the `bigint` range, and the CHECK constraint rejects values
  below 1.
- Provisioning semantics (ADR-017). See "Provisioning result" below.

### Provisioning result (reviewed, unchanged)

The audit asked whether provisioning should report `created`, `existing` or
`repaired` instead of `created: insertedProfiles.count > 0 ||
insertedCharacters.count > 0`. Decision: keep the boolean.

- The only consumer is the HTTP status. The client handles 200 and 201
  identically.
- "Repaired" means the profile existed but the slot-1 character did not, so
  the call created the character. 201 Created is the correct status for that.
- The state is unreachable today. Both rows are inserted in one transaction,
  and deleting a profile cascades to its characters. No character-deletion
  path exists.
- The repair path is covered by an integration test against PostgreSQL.

A third outcome would be justified by a consumer: an audit or alert when a
future account-deletion or character-deletion flow leaves a profile without its
main character. That flow is PLANNED. It should introduce the distinction
together with its observability, rather than adding an unused state now.

## Consequences

- **Breaking wire change:** `CharacterDto.stage` (in `GET /player/state`,
  `POST /player` and `GET /player/characters/:id`) changes from a JSON number
  to a canonical decimal string. The only client, `apps/web`, is updated in the
  same change, and nothing is deployed yet.
- Breaking Game Core API change: callers pass `StageNumber` instead of
  `number`. There are no callers outside this repository.
- Every stage from 1 to 2^63 − 1 now round-trips exactly through PostgreSQL,
  the repository and the API. Integration tests cover 2^53 + 1 and 2^63 − 1,
  and the web formatter is unit-tested at the same values.
- **Leaderboards (Phase 10):** ADR-013 lets "integer-range ladders such as
  Highest Stage" use the raw value as the Redis sorted-set score. A double is
  exact only up to 2^53. Phase 10 must either:
  - prove, from the rule sets in force, that no reachable stage exceeds 2^53,
    and assert that bound when it writes the score; or
  - use a projection with read-time tie-breaking against PostgreSQL, as
    ADR-013 already specifies for `HugeNumber`.
  PostgreSQL remains the exact source of truth either way.
- Future stage-like counters (Tower floor, Eternal Levels) should reuse the
  same pattern: a `bigint` value object, a `bigint` column and a canonical
  decimal string on the wire. They should not reuse `number`.

## Alternatives Considered

**Keep `number` and lower the database ceiling to 2^53 − 1 with a CHECK.**
Consistent and simpler. Rejected: it keeps floating-point arithmetic in
authoritative code, and it puts the precision limit of one client language
into the schema.

**Use `HugeNumber` for stages.** Rejected: HugeNumber approximates and rounds
at 18 significant digits. A stage needs exact successor, equality and
divisibility, and its range fits `bigint`.

**Use a branded `bigint` type instead of a class.** Cheaper at runtime, but it
cannot own validation, the canonical form or `toJSON`. A raw `bigint` makes
`JSON.stringify` throw, and a brand is too easy to bypass with a cast. Rejected.

**Serialise the stage as a JSON number and ask clients to use a lossless JSON
parser.** Rejected: every standard browser and Node parser rounds, and the
failure would be silent.

**Define `StageNumber` in the API domain rather than in Game Core.** Rejected:
Game Core already reasons about stages (scaling, bosses, simulation). Two
implementations would drift, which is exactly the inconsistency this ADR
removes.

**Unbounded stages (arbitrary-size `bigint`, `numeric` column).** Rejected for
now. `RULES_V1` cannot scale an enemy past roughly 4·10^10 stages, and `numeric`
would cost the column its cheap index order. It can be revisited through a
new ADR if a mechanic ever needs it.
