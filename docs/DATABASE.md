# Eternal Forge — Database Design

Status: EARLY DESIGN — infrastructure IMPLEMENTED (Phase 0), identity tables
IMPLEMENTED (Phase 2), progression and combat history IMPLEMENTED (Phase 3),
everything else PLANNED

Tables are created by the phase that requires them, so the repository carries no
speculative schema. Phase 2 added `profiles` and `characters` (ADR-017). Phase 3
added progression columns to `characters` and the `combat_runs` table (migration
`20260923053138_gameplay_loop`, ADR-019). The Phase 3 final audit split the
stage into the current stage and two records (migration
`20260923090000_stage_progression`, ADR-020). Phase 4 PR 4.1 added the stage
mode (migration `20260923140000_stage_selection`, ADR-021). Phase 4 PR 4.3
added `characters.offline_seed` and the `offline_runs` table (migration
`20260923180000_offline_progression`, ADR-023). Everything else under
"Planned domains" below is PLANNED.

Database:

PostgreSQL.

Primary persistence provider:

Supabase PostgreSQL.

ORM:

Prisma 7.

Connection strings are supplied through `prisma.config.ts` for Migrate and
through the `pg` driver adapter at runtime; Prisma 7 no longer accepts them in
`schema.prisma`. Migrate uses `DIRECT_URL` — DDL cannot run through Supabase's
transaction pooler. See ADR-011.

---

# Principles

PostgreSQL is the persistent source of truth.

Redis is not a replacement for persistent game state.

Avoid one giant JSON document representing the entire player.

Use relational modeling for important persistent entities.

JSONB may be used where flexible data genuinely makes sense.

---

# Identity

Authentication identity is provided by Supabase Auth.

Application profile data must remain conceptually separate from authentication
credentials.

Never store plaintext passwords.

Status: IMPLEMENTED (Phase 2). No table in our schema stores a password, a
token or any credential. Supabase Auth owns them (ADR-016). The Supabase user id
appears in exactly one column, `profiles.auth_user_id`; every other table
references our own `profiles.id` (ADR-017).

---

# Planned domains

The following schema is directional.

Tables should only be created when their phase requires them.

---

# Player

Status: `profiles` and `characters` IMPLEMENTED (Phase 2, migration
`20260922201944_player_identity`, ADR-017). `player_settings` PLANNED.

profiles

| Column         | Type             | Rules                                            |
| -------------- | ---------------- | ------------------------------------------------ |
| `id`           | `uuid`           | PK, `gen_random_uuid()`                          |
| `auth_user_id` | `uuid`           | NOT NULL, UNIQUE — one profile per Supabase user |
| `display_name` | `varchar(24)`    | CHECK 3–24 characters, no surrounding whitespace |
| `created_at`   | `timestamptz(3)` | default `now()`                                  |
| `updated_at`   | `timestamptz(3)` | maintained by Prisma                             |

characters

| Column       | Type             | Rules                                                |
| ------------ | ---------------- | ---------------------------------------------------- |
| `id`         | `uuid`           | PK, `gen_random_uuid()`                              |
| `profile_id` | `uuid`           | FK → `profiles.id` ON DELETE CASCADE                 |
| `slot`       | `smallint`       | CHECK ≥ 1; UNIQUE (`profile_id`, `slot`); main = 1   |
| `name`       | `varchar(24)`    | CHECK 3–24 characters, no surrounding whitespace     |
| `level`      | `integer`        | default 1, CHECK ≥ 1                                 |
| `stage`      | `bigint`         | default 1, CHECK ≥ 1 — renamed `current_stage` by ADR-020 |
| `created_at` | `timestamptz(3)` | default `now()`                                      |
| `updated_at` | `timestamptz(3)` | maintained by Prisma                                 |

Indexes: the two unique constraints are the only indexes, and they cover the
actual queries — profile by `auth_user_id`, character by `(profile_id, slot)`,
characters of a profile (leading column `profile_id`).

`stage` maps one-to-one to Game Core's `StageNumber` (ADR-018): every value
the column accepts, 1 to 2^63 − 1, is read and written as an exact `bigint`
and is never converted to a JavaScript `number`. The column type bounds it
from above and the CHECK from below.

(The table above is the Phase 2 shape. See "Stage progress" below for the
current stage columns.)

Only source state is stored. Combat stats, the experience requirement and the
enemy on the current stage are derived by Game Core and are not persisted.

Added in Phase 3 (ADR-019):

| Column                              | Type                | Rules                                                     |
| ----------------------------------- | ------------------- | --------------------------------------------------------- |
| `experience_coef`, `experience_exp` | `bigint`, `integer` | HugeNumber pair (ADR-013); experience *within* the level  |
| `gold_coef`, `gold_exp`             | `bigint`, `integer` | HugeNumber pair                                           |
| `next_combat_at`                    | `timestamptz(3)`    | pacing gate; written from the API clock                   |
| `version`                           | `bigint`            | default 0, CHECK ≥ 0; optimistic concurrency token        |

Every HugeNumber pair carries two CHECKs: ADR-013's normalisation rule, which
also makes negatives unstorable, and a whole-amount rule, which rejects
fractions.

Row Level Security is enabled on both tables with no policies (deny by default
for every non-owner role); on Supabase the migration also revokes the `anon` and
`authenticated` roles' privileges. See docs/SECURITY.md — "Supabase".

Not yet enforced by the database: a foreign key from `auth_user_id` to Supabase's
`auth.users` (ADR-017 explains why). Account deletion must remove the profile
explicitly.

Stage progress — changed by the Phase 3 final audit (ADR-020, migration
`20260923090000_stage_progression`):

| Column                  | Type     | Rules                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------ |
| `current_stage`         | `bigint` | was `stage`; default 1, CHECK ≥ 1; where the next combat is fought |
| `highest_stage_reached` | `bigint` | NOT NULL, default 1, CHECK ≥ 1; never decreases                    |
| `highest_stage_cleared` | `bigint` | NULL until the first victory, else CHECK ≥ 1; never decreases      |

Cross-column CHECKs: `current_stage ≤ highest_stage_reached`, and
`highest_stage_cleared` is NULL or `≤ highest_stage_reached`. All three map
one-to-one to Game Core's `StageProgress` of exact `StageNumber`s. A row that
breaks an invariant cannot be stored, and the repository refuses to read one.

Backfill rule: a stage counts as cleared only when a recorded `WIN` on it
exists in `combat_runs`. Reached is the greatest of the current stage, the
highest stage fought and the highest stage won + 1. A Phase 2 character on
stage 7 with no combats becomes `7 / 7 / NULL`, so nothing is claimed that the
data does not prove. The migration was verified from an empty database, from
the Phase 2 schema and from Phase 3 data, with no drift in any case.

Stage mode — added by Phase 4 PR 4.1 (ADR-021, migration
`20260923140000_stage_selection`):

| Column       | Type                                   | Rules                                                                 |
| ------------ | -------------------------------------- | --------------------------------------------------------------------- |
| `stage_mode` | enum `stage_mode` (`PROGRESS`, `FARM`) | NOT NULL, default `PROGRESS`; what a victory does to `current_stage` |

`current_stage` doubles as the selected farm stage; no second column exists.
The existing CHECK `current_stage ≤ highest_stage_reached` bounds every
selection in the database as well. A selection writes only `current_stage`,
`stage_mode` and `version`. Backfill: every existing character `PROGRESS`.

Rankings (Phase 10, PLANNED) will rank `highest_stage_cleared`: a proven,
monotonic value that farming cannot lower. The index for that query arrives
with the ranking, not before.

player_settings

Potential fields:

profile_id
language
settings

---

# Progression

Status: IMPLEMENTED (Phase 3) as columns of `characters` — `level`, the stage
progress (`current_stage`, `highest_stage_reached`, `highest_stage_cleared`,
ADR-020), experience, gold, `next_combat_at` and `version` (see "Player"). A separate
`character_progress` table was not needed: progression is one row per
character, read and written together.

IMPLEMENTED (Phase 4 PR 4.3, ADR-023): the processed boundary of offline
progression is `next_combat_at` itself — no separate `last_processed_at`
column exists. Online combat and offline claims both move it forward inside
their version-conditional write. A `player_resources` table for further
resource types arrives with the first second resource.

Do not assume amount always fits a JavaScript integer.

HugeNumber persistence format: DECIDED — ADR-013, accepted 2026-09-22.
IMPLEMENTED in Phase 3 by `characters` and `combat_runs`.

Each persisted HugeNumber uses two columns, `<name>_coef bigint` and
`<name>_exp integer`, non-negative by constraint and ordered by `(exp, coef)`.
Zero is `coef = 0` with the sentinel `exp = -2147483648`. They map one-to-one to
`HugeNumber.toParts()` / `HugeNumber.fromParts()` in Game Core, so the
repository layer never re-implements normalisation.

Signed quantities such as ledger entries store a non-negative magnitude plus a
direction. The current balance may be stored as state; the ledger is the
auditable history. SQL cannot sum these columns, so reconciliation replays the
ledger through HugeNumber — as an audit procedure, not on ordinary requests.

A consequence that is easy to discover too late: Redis sorted sets score members
with an IEEE-754 double. A leaderboard over a HugeNumber quantity — Boss Damage,
for example — therefore cannot use the raw value as a sorted-set score without
losing precision. The exact value must live in PostgreSQL and the sorted set
must hold a monotonic projection of it. See ADR-013 and the "Leaderboards"
section below.

---

# Items

item_definitions

Represents game content.

item_instances

Represents owned/generated items.

Potential relation:

item_instance
-> item_definition
-> owner

item_affixes

Represents generated affixes on an item instance.

item_sockets

Represents sockets/runes.

---

# Skills

skill_definitions

character_skills

passive_nodes

character_passive_nodes

Do not add a database column for every possible future skill.

---

# Combat history

Status: IMPLEMENTED (Phase 3, ADR-019).

combat_runs — one row per resolved combat

| Group        | Columns                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| identity     | `id` uuid PK, `character_id` FK → `characters` ON DELETE CASCADE, `idempotency_key` uuid, `created_at` (resolution time, API clock) |
| replay input | `rules_version`, `seed` varchar(64), `stage` bigint (the stage fought), `highest_stage_reached_before` bigint, `highest_stage_cleared_before` bigint NULL (ADR-020), `stage_mode` enum NOT NULL, no default (ADR-021; existing rows backfilled `PROGRESS`), `character_level`, `experience_before_*`, `gold_before_*` |
| audit output | `outcome` (enum WIN/LOSS), `end_reason` (enum), `duration_ms`, `reward_gold_*`, `reward_experience_*` |

Constraints: UNIQUE `(character_id, idempotency_key)`. Every HugeNumber pair is
normalised and whole. `rules_version`, `stage` and `character_level` must be
≥ 1, `duration_ms` ≥ 0 and the seed non-empty. The stage fought is at most
`highest_stage_reached_before`, and `highest_stage_cleared_before` is NULL
or between 1 and `highest_stage_reached_before`. `outcome = WIN` exactly when
`end_reason = ENEMY_DEFEATED`, and a loss pays nothing. That last rule means
"no reward on defeat" holds in the ledger whatever code path wrote the row.
Row Level Security is enabled with no policies, and `anon` and
`authenticated` are revoked.

Index: only the unique index. It serves the idempotency lookup, the per-character
history and the cascading delete.

The event log is not stored. Game Core regenerates it exactly from the replay
inputs, and a replay is checked against the audit columns. The table is also
the credit ledger for gold and experience in Phase 3. Replaying its rewards
through HugeNumber reproduces the character's balance, and an integration test
proves this.

---

# Economy

economy_transactions

Important fields conceptually include:

id
player_id
resource_type
amount
reason
source_type
source_id
created_at
idempotency_key where applicable

Purpose:

auditability.

---

# Prestige

prestige_progress

Possible concepts:

character_id
prestige_type
count
persistent_currency

Exact schema depends on implemented prestige rules.

---

# Leaderboards

leaderboard_definitions

leaderboard_entries

leaderboard_snapshots

Active rankings may live in Redis.

Persistent snapshots live in PostgreSQL.

For any ranking whose metric is a HugeNumber, PostgreSQL holds the exact value
and Redis holds only the ordering key. Ties at the projection's granularity are
broken against the exact value on read (ADR-013).

---

# Guilds

FUTURE.

guilds
guild_members
guild_roles or role representation
guild_progress

Exact schema will be designed during the Guild phase.

---

# Seasons

FUTURE.

seasons
season_player_progress
season_rewards
season_snapshots

Permanent and seasonal state must be clearly separated.

---

# PvP

FUTURE.

arena_ratings
arena_build_snapshots
arena_matches

Do not store mutable live player state as historical match state.

Use appropriate snapshots.

---

# Constraints

Use database constraints where appropriate.

Examples:

unique relationships
foreign keys
non-negative constraints where valid
ownership constraints

Application validation does not replace database integrity.

---

# Indexes

Indexes must be created based on actual query patterns.

Likely future examples:

profile lookup by auth_user_id

inventory by owner

leaderboard by metric

transactions by player/date

guild members by guild

Do not add speculative indexes everywhere.

---

# Rules version

Any table that persists the result of a deterministic simulation — combat
results, arena snapshots, offline progression — must record the
`GAME_RULES_VERSION` in force when the result was produced.

Without it, a replay after a balance patch is compared against rules that did
not apply at the time. See ADR-005.

Status: IMPLEMENTED (Phase 3). `combat_runs.rules_version` records the rule set
each combat ran under, and replays resolve under that version. The Phase 2
tables store player state, not simulation results, and carry no rules version.

---

# Migrations

Every schema change must use a migration.

Never manually alter production schema without reflecting the change in the
repository migration history.

Status: IMPLEMENTED. Migrations live in `packages/database/prisma/migrations`
and are applied with `pnpm run db:deploy`. Constraints Prisma cannot model
(CHECKs, Row Level Security, privilege revocations) are written into the
migration SQL. CI applies the migrations to a fresh PostgreSQL and fails if they
drift from `schema.prisma` (`prisma migrate diff --exit-code`).

---

# Transactions

Atomic economy operations use transactions.

Examples:

upgrade item:

- subtract gold,
- update item,
- record transaction.

All succeed or all fail.

---

# Concurrency

Consider concurrent requests.

Implemented example (Phase 2): player provisioning runs `INSERT … ON CONFLICT DO
NOTHING` for the profile and the main character inside one transaction, relying
on the unique constraints. Concurrent requests converge on one profile and one
character; an integration test fires 25 in parallel against PostgreSQL.

Implemented example (Phase 3, ADR-019): combat uses optimistic concurrency. The
character update carries `WHERE version = <read version>`, and PostgreSQL
re-evaluates it after waiting on the row lock, so of two concurrent writers
exactly one matches. Game Core runs before the transaction, which stays two
statements long. Integration tests fire 25 simultaneous combats at one
character and interleave retried requests across two API instances. Each
case produces exactly one combat, one reward and one stage change.

Implemented example (Phase 4 PR 4.1, ADR-021): stage selection uses the same
`version`. Its write is `UPDATE … WHERE version = <read version>`, so a
combat simulated before a selection cannot commit after it, and a selection
that loses to a combat re-validates against the fresh row. An integration
test races selections, climbs and combats across two API instances.

Example:

two simultaneous upgrade requests must not both spend the same resources.

Use appropriate:

transactions
constraints
locks
optimistic concurrency

depending on the operation.

---

# Idempotency

Reward/financial-like operations should use idempotency where duplicate
delivery is possible.

Never rely solely on frontend button disabling.

`economy_transactions` names an `idempotency_key`, but idempotency is required
by more operations than that table records: ClaimOfflineRewards, ClaimSeasonReward,
CraftItem, Purchase and Prestige (docs/ARCHITECTURE.md — "Idempotency").

Those operations need a single mechanism rather than a per-table column, since
some of them produce no economy transaction at all. The intended shape is a
dedicated table keyed by `(player_id, operation, idempotency_key)` with a unique
constraint, storing the result of the first successful execution so a retry
replays it instead of re-running the operation.

Status: combat IMPLEMENTED (Phase 3); offline claims IMPLEMENTED (Phase 4
PR 4.3) the same way, with `offline_runs` as their natural result record,
unique on `(character_id, idempotency_key)` (ADR-023 §11). The first idempotent command resolves a
combat, and the combat row is its natural result record. It is keyed by the
unique `(character_id, idempotency_key)`, and a retry replays it by
deterministic re-simulation (ADR-019). The generic table above is still
PLANNED: the offline claim turned out to have a natural result row, so it was
not needed in Phase 4.

---

# Data deletion

Future account deletion requirements must include dependent game data.

Do not implement until required, but avoid schema designs that make ownership
impossible to determine.

---

# Backups

Production PostgreSQL must use an appropriate backup/recovery strategy.

Exact provider configuration belongs to deployment operations documentation.

---

# Offline progression

Status: IMPLEMENTED (Phase 4 PR 4.3, ADR-023, migration
`20260923180000_offline_progression`).

`characters` — added:

| Column         | Type          | Rules                                                                                       |
| -------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `offline_seed` | `varchar(64)` | NOT NULL, CHECK non-empty; default two `gen_random_uuid()` (backfill and new rows); replaced by a 256-bit API CSPRNG seed on every committed claim; never sent to a client |

`offline_runs` — one row per claim that fought (a claim with nothing to
collect writes no row):

| Group        | Columns                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| identity     | `id` uuid PK, `character_id` FK → `characters` ON DELETE CASCADE, `idempotency_key` uuid, `created_at` (the claim's server time) |
| time line    | `idle_since` (boundary before), `rewarded_from` (`idle_since`, or `created_at − cap`), `processed_until` (new boundary) |
| replay input | `rules_version`, `seed`, `current_stage`, `highest_stage_reached`, `highest_stage_cleared` (NOT NULL), `character_level`, `experience_before_*`, `gold_before_*` |
| audit output | `target_stage`, `fights`, `wins`, `losses`, `levels_gained`, `reward_gold_*`, `reward_experience_*`        |

Constraints: UNIQUE `(character_id, idempotency_key)`; `idle_since ≤
rewarded_from < processed_until ≤ created_at`; stage-progress invariants;
`1 ≤ target_stage ≤ highest_stage_cleared` (offline never fights an uncleared
stage); `fights ≥ 1`, `wins + losses = fights`; no reward and no level
without a win; every HugeNumber pair normalised and whole; `rules_version ≥
1`; non-empty seed. Row Level Security enabled with no policies, `anon` and
`authenticated` revoked.

Index: only the unique index (idempotency lookup, per-character history,
cascading delete).

Individual offline fights are not stored — neither here nor in
`combat_runs`, whose meaning (one row per online combat) is unchanged. Game
Core regenerates every fight from the replay inputs (`verifyOfflineRun`).
The row is the ledger entry for the claim's gold and experience.

# Inventory and equipment — COMPLETE / APPROVED (Phase 5 PR 5.2, ADR-025)

`item_instances` persists UUID identity, direct character ownership, canonical definition ID and rarity, and creation time. Inventory is this relation, ordered by `(created_at, id)`. `character_equipment` uses primary key `(character_id, slot)`, unique `item_instance_id`, and a composite owner FK to enforce that equipped items belong to the same character. Canonical rarity/slot values are constrained text. Character deletion cascades; trusted item deletion cascades its equipment row and no player deletion endpoint exists.

# Combat item rewards — IN PROGRESS (Phase 5 PR 5.3, ADR-026)

Migration `20260924180000_combat_item_drops` adds nullable `item_instances.combat_run_id`, a unique index of the same name, and a cascading composite FK `(combat_run_id, character_id)` to `combat_runs(id, character_id)`. Null preserves trusted non-combat creation; non-null identifies the one authoritative combat that minted the instance and proves matching character ownership. The combat row, optional item and character progression are inserted in one transaction. The existing `(character_id, idempotency_key)` combat uniqueness plus the new one-item-per-combat uniqueness enforce exactly-once materialization.
