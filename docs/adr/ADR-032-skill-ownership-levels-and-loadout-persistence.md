# ADR-032 — Skill ownership, levels and loadout persistence

## Status

Proposed — 2026-10-01 (Phase 7, PR 7.2).

## Date

2026-10-01

## Context

PR 7.1 (ADR-031) gave Game Core a pure active-skill domain: stable
`SkillDefinitionId`s, `SkillLevel` (1 … 2^31 − 1), a six-entry
`SKILL_CATALOG` with no approved tuning, combat-time cooldowns and an
activation policy that takes candidates in the caller's priority order. It
deliberately had no persistence, no API and no combat effect.

PR 7.3 will cast skills inside the server's simulation and must snapshot "the
loadout in priority order with each skill's identity and level" (ADR-031,
"Replay"). That snapshot can only be as coherent as the source state it reads.
PR 7.2 therefore persists that source state — which skills a character owns,
at what level, and which of them it has equipped in what order — and lets the
player configure the order, without changing what combat does.

Existing facts that constrain the design:

- `characters.version` is the single optimistic-concurrency token shared by
  combat, offline claims, stage selection and equipment (ADR-019, ADR-021,
  ADR-025). Combat already reads equipment at the version it commits
  against (ADR-029).
- Relation reads span several SQL statements under Prisma; reads that report
  a version run in one `REPEATABLE READ` transaction so the version names
  exactly the state returned (ADR-030).
- Static content (item definitions, affix definitions, skill definitions) is
  Game Core data, not database rows (ADR-024, ADR-028, ADR-031).
- Browser roles never touch game tables: RLS on with no policies, `anon` and
  `authenticated` revoked when they exist (docs/SECURITY.md — "Supabase").
- No document defines how a skill is acquired, how it is levelled, what
  either costs, or which skills a new character starts with.

## Decision

### Source state only

Persisted per character:

- **owned skills** — a stable `SkillDefinitionId` string and a `SkillLevel`
  integer per owned skill. An unowned skill has no row; there is no level 0.
- **the loadout** — an ordered list of owned skills.

Never persisted: a `ResolvedSkill`, a resolved cooldown or parameter,
cooldown state, `nextReadyAtMs`, or any derived skill power. Those are
functions of source state and a versioned rule set, and PR 7.3's per-combat
snapshot will record whatever a combat used.

### Schema (migration `20261001120000_skill_ownership_loadout`)

`character_skills` — primary key `(character_id, skill_definition_id)`;
`level integer NOT NULL CHECK (level >= 1)` (the `integer` type is the upper
bound and equals `SKILL_LEVEL_MAX`); `skill_definition_id varchar(64)` with
the same format CHECK as `item_instances.definition_id`; `created_at`;
FK `character_id → characters` `ON DELETE CASCADE`.

`character_skill_loadout` — primary key `(character_id, position)`;
`position smallint CHECK (position >= 0)`; `UNIQUE (character_id,
skill_definition_id)`; FK `character_id → characters` `ON DELETE CASCADE`;
and the composite FK `(character_id, skill_definition_id) →
character_skills` — **PostgreSQL itself refuses an unowned skill**, including
another character's. The composite FK is `NO ACTION`, checked at the end of
the statement: an equipped skill's ownership row cannot be deleted, while
deleting the character still cascades through both tables.

No `skill_definitions` table: definitions and tuning stay Game Core content.
The primary keys serve every query (owned skills by character; loadout by
character ordered by position); no other index is added. RLS is enabled on
both tables with no policies, and `anon`/`authenticated` are revoked when
those roles exist, in the portable form earlier migrations use.

### Loadout size: four (`SKILL_LOADOUT_MAX_SIZE = 4`)

No design document named a size, so this is an explicit Phase 7 product
decision: four equipped skills. Four leaves room for meaningful priority
decisions, keeps unequipped skills relevant as the catalog grows past six,
bounds the PR 7.3 scheduler, and fits one row of controls at 390 px.

It is one Game Core constant. The shared contract reads it, the API reports
it to clients as `maxLoadoutSize`, and the database stores positions without
repeating it (the CHECK is `position >= 0` only), so changing the size is a
rule change that needs no migration. The application guarantees positions
`0 … n − 1` without holes because it only ever writes a whole loadout.

### Priority

Loadout order **is** cast priority: index 0 is the highest, exactly the order
`selectSkillActivation` consumes. Position is 0-based in Game Core, the
database and the wire (`priority`). Catalog declaration order is never a
priority; owned skills are *listed* in catalog order for a stable
presentation, and the two orders are not confused. The priority becomes
combat input only in PR 7.3.

### Validation lives in Game Core

`createCharacterSkills({ owned, loadout })` validates and canonicalises a
character's skill state; `replaceSkillLoadout` applies a new loadout with the
same checks; `sameSkillLoadout` compares two loadouts. Checks, in a fixed
order so the reported reason is deterministic: owned skills known and unique;
loadout size (`SKILL_LOADOUT_TOO_LARGE`); duplicates (`DUPLICATE_SKILL`);
catalog membership (`UNKNOWN_SKILL_DEFINITION`); ownership
(`SKILL_NOT_OWNED`). Nothing is dropped or reordered silently. An empty
loadout is valid, with or without owned skills.

The same function validates what is **read**: a persisted identity the
catalog no longer knows, a duplicate, an unowned loadout entry or a hole in
the positions is corrupt authoritative state and fails explicitly (a 500),
never repaired or ignored. Shipped skill identities are therefore permanent.

### Set semantics and idempotency

The only player-facing write replaces the whole loadout:
`PUT /player/characters/:characterId/skills/loadout` with
`{ "skillIds": ["execute", "fireball", "shield"] }`. The server derives
positions, levels and ownership. Patching individual slots, and holes or
conflicting positions, are impossible by construction.

The same loadout in the same order is a **no-op**: nothing is written and the
version does not change (as with an unchanged stage selection and an
already-equipped item). A new order of the same skills is a real change.
Repeating a request leaves the same state, so no idempotency key is needed.

### Concurrency and atomicity

`SetSkillLoadoutUseCase`: read the state (one snapshot), validate in Game
Core, and if it changes anything write it in one transaction:

1. `UPDATE characters SET version = version + 1 WHERE id AND version =
   expected AND owner` — zero rows means conflict and nothing is written;
   otherwise the row lock is held until commit;
2. delete every loadout row of the character;
3. insert the new rows at positions `0 … n − 1`.

A concurrent replacement, combat, equip or trusted grant either commits
entirely before or entirely after; no reader ever sees a half-written
loadout, and two replacements never interleave. On conflict the request is
validated again against the fresh state, at most three attempts, then
`409 CONCURRENT_UPDATE`. No process-local lock is used.

Every skill source-state write — loadout, ownership, level — advances
`characters.version`. No skill-specific counter is introduced: skills are
part of the character's gameplay state, and PR 7.3's combat will read level,
equipment and skills at one version and commit against it. A consequence,
shared with equipment, is that a loadout change committed while a combat is
being resolved makes that combat's commit conflict.

### Authoritative read

`GET /player/characters/:characterId/skills` returns `characterVersion`,
`maxLoadoutSize`, `owned` (`skillId`, `nameKey`, `level`, catalog order) and
`loadout` (the same plus `priority`, priority order). The read is one
owner-scoped query inside one `REPEATABLE READ` transaction (ADR-030), so the
version always names exactly the loadout returned. A character with no skills
answers `owned: []`, `loadout: []` — an intentional state, not a 404.

### Errors

| Situation                                           | Response                         |
| --------------------------------------------------- | -------------------------------- |
| malformed ID, too many, duplicate, extra field      | 400 `VALIDATION_FAILED` (contract) |
| well-formed ID unknown to the catalog               | 400 `VALIDATION_FAILED`          |
| known skill the character does not own              | 409 `SKILL_NOT_OWNED` (new code) |
| missing or another player's character               | 404 `NOT_FOUND`                  |
| version kept moving                                 | 409 `CONCURRENT_UPDATE`          |
| corrupt persisted state                             | 500 `INTERNAL_ERROR`, logged      |

### No acquisition, levelling or starter skills yet

No acquisition economy is invented: no prices, unlock levels, skill books or
skill drops, and no public route grants, removes or levels a skill. Existing
characters migrate to zero owned skills and an empty loadout, and new
characters are provisioned the same way — the migration and provisioning
grant nothing. Starter content and acquisition are decided with approved
tuning in PR 7.4.

The only ownership/level write is `SkillRepository.saveTrustedSkill`, a
trusted server path (and test fixture) that validates the identity against the
catalog, takes a `SkillLevel`, upserts the row and advances the version in one
transaction — the same precedent as `createTrustedItem` (ADR-025). No HTTP
route calls it.

### Contracts

`packages/contracts` adds `skillStateResponseSchema` and
`setSkillLoadoutRequestSchema`. The identity format is delegated to a new
`SkillDefinitionId.isCanonical`, and the size to `SKILL_LOADOUT_MAX_SIZE`,
so neither rule is written twice. This widens ADR-013's approved
contracts → Game Core edge from `HugeNumber` to these two pure, rule-free
values; `apps/web` still imports only `HugeNumber` from Game Core directly.

### Rules version

Nothing here executes in combat. `GAME_RULES_VERSION` stays 3, `RULES_V1` to
`RULES_V3` are unchanged and every combat golden fingerprint is unchanged;
an integration test proves a character with a full loadout fights exactly like
one without.

## Consequences

- PR 7.3 can load level, equipment and the ordered skill loadout with levels
  at one version and snapshot them into a `CombatRun`, with no schema change
  to these tables.
- PR 7.4 builds the Skills screen on the read and the loadout command; it
  reads `maxLoadoutSize` from the response instead of hard-coding it.
- Ownership integrity holds in three places: Game Core on write, the
  composite FK in PostgreSQL, Game Core again on read.
- A loadout change, like an equip, can turn a concurrently resolving combat
  into `409 CONCURRENT_UPDATE`; clients already handle it.
- Removing a skill from the catalog would make characters that own it
  unreadable. Identities are permanent; a retired skill must stay in the
  catalog (possibly without tuning).
- One API error code is added (`SKILL_NOT_OWNED`), and three Game Core codes
  (`SKILL_LOADOUT_TOO_LARGE`, `DUPLICATE_SKILL`, `SKILL_NOT_OWNED`).

## Alternatives Considered

**A `skill_definitions` table referenced by foreign keys.** Rejected: it
duplicates static Game Core content in a second place that must be kept in
sync, as ADR-024 rejected for items. Catalog membership is checked by Game
Core on write and on read.

**Loadout as a column on `character_skills` (`equipped_position NULL`).**
Rejected: uniqueness of positions then needs a partial unique index, and an
atomic reorder rewrites ownership rows. A separate table keeps ownership and
configuration apart and lets the composite FK enforce ownership.

**A JSONB array of skill IDs on `characters`.** Rejected: no foreign key can
enforce ownership or uniqueness inside it (docs/DATABASE.md prefers relational
modelling for important persistent entities).

**Position objects in the request (`[{ position, skillId }]`).** Rejected:
it admits holes, duplicate positions and conflicting orders that the server
would then have to reject; an ordered array cannot express them.

**Per-slot PATCH commands.** Rejected: several requests to express one
intent, with intermediate states visible to readers and to PR 7.3's combat
snapshot.

**A skill-specific version counter.** Rejected: combat must read skills and
the rest of the character at one coherent version; two counters would let a
combat commit against a skill state it did not read.

**A database CHECK `position < 4`.** Rejected: it would repeat the Game Core
rule and turn a size change into a migration.

**Granting all six candidates, or a starter skill, in the migration or at
provisioning.** Rejected: acquisition and starter content are gameplay
decisions without approved design or tuning.

**A version bump on an identical loadout.** Rejected: it would conflict a
concurrent combat for no change of state.

## Deferred work

- **PR 7.3:** the combat scheduler and its per-combat skill snapshot, read at
  the same version as equipment; `RULES_V4`; offline progression's treatment
  of skills.
- **PR 7.4:** approved tuning, starter skills and acquisition/levelling (with
  their costs, transactional and auditable), the Skills screen and loadout
  editor.
- **Later:** removing or respeccing skills, if a design wants it.
