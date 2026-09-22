# Eternal Forge — Database Design

Status: EARLY DESIGN — infrastructure IMPLEMENTED (Phase 0), schema PLANNED

The Prisma schema currently declares **no models**. That is deliberate: tables
are created by the phase that requires them, so the repository carries no
speculative schema. Everything under "Planned domains" below is PLANNED.

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

---

# Planned domains

The following schema is directional.

Tables should only be created when their phase requires them.

---

# Player

profiles

Potential fields:

id
auth_user_id
display_name
created_at
updated_at

characters

Potential fields:

id
profile_id
name
created_at
updated_at

player_settings

Potential fields:

profile_id
language
settings

---

# Progression

character_progress

Potential concepts:

character_id
stage
level
experience
last_processed_at

player_resources

Potential concepts:

character_id
resource_type
amount

Do not assume amount always fits a JavaScript integer.

HugeNumber persistence format must be deliberately designed.

Status: DECIDED — ADR-013, accepted 2026-09-22. The columns themselves are
PLANNED and arrive with the first table that persists a HugeNumber.

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

Status: PLANNED; applies from the first such table in Phase 3.

---

# Migrations

Every schema change must use a migration.

Never manually alter production schema without reflecting the change in the
repository migration history.

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

Status: PLANNED — to be designed with the first idempotent command, in Phase 4.

---

# Data deletion

Future account deletion requirements must include dependent game data.

Do not implement until required, but avoid schema designs that make ownership
impossible to determine.

---

# Backups

Production PostgreSQL must use an appropriate backup/recovery strategy.

Exact provider configuration belongs to deployment operations documentation.
