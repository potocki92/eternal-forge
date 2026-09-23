# ADR-017 — Player identity persistence and provisioning

## Status

Accepted

## Date

2026-09-22

## Context

Phase 2 introduces the first tables. They anchor everything that follows —
inventory, progression, offline progress, prestige, rankings, guilds, arena and
seasons all reference a player. Decisions made here are expensive to reverse.

Requirements:

- Link each Supabase Auth user to exactly one game profile.
- One main character per profile now, without making more impossible later.
- Store the source of state, not values Game Core can derive.
- Creating the player must be transactional, idempotent and safe under
  concurrent requests (double submit, retry, two tabs).
- Local development and CI run on plain PostgreSQL, without Supabase's `auth`
  schema.

## Decision

### Identifiers

- `profiles.id` is our own UUID (`gen_random_uuid()`), and it is what every
  other table references. The Supabase user id appears in exactly one column,
  `profiles.auth_user_id`, with a unique constraint (which is also its lookup
  index).
- The API response never includes `auth_user_id`.

### Schema

```
profiles
  id            uuid PK default gen_random_uuid()
  auth_user_id  uuid NOT NULL UNIQUE
  display_name  varchar(24) NOT NULL  CHECK 3–24 chars, trimmed
  created_at    timestamptz(3) NOT NULL default now()
  updated_at    timestamptz(3) NOT NULL

characters
  id          uuid PK default gen_random_uuid()
  profile_id  uuid NOT NULL → profiles.id ON DELETE CASCADE
  slot        smallint NOT NULL  CHECK slot >= 1
  name        varchar(24) NOT NULL  CHECK 3–24 chars, trimmed
  level       integer NOT NULL default 1  CHECK level >= 1
  stage       bigint  NOT NULL default 1  CHECK stage >= 1
  created_at, updated_at
  UNIQUE (profile_id, slot)
```

- **Slots.** The main character is slot 1. `UNIQUE (profile_id, slot)` gives
  provisioning its idempotency key and makes "how many characters" a product
  decision rather than a migration.
- **Source state only.** A character stores `level` and `stage`. Health, damage
  and every other combat stat are derived by Game Core from `level` under a
  versioned rule set and are not persisted. Experience, gold and other resources
  arrive with the phase that awards them (Phase 3), as HugeNumber columns per
  ADR-013.
- **Stage is `bigint`**, because stages are effectively unlimited
  (`docs/GAME_DESIGN.md`). The domain and the wire use safe integers; the
  repository refuses a stored value above 2^53 − 1 rather than rounding it.
- **Row Level Security** is enabled on both tables with no policies, so any
  non-owner role — on Supabase, the `anon` and `authenticated` roles that
  PostgREST exposes — sees nothing. The migration also revokes their table
  privileges where those roles exist. The API connects as the owner and is
  unaffected; backend authorization remains the enforcing control
  (`docs/SECURITY.md`).
- CHECK constraints and RLS are in the migration SQL, since Prisma cannot model
  them. CI verifies the migrations and the Prisma schema do not drift.

### Naming rule

Display and character names share one rule, published in
`@eternal-forge/contracts`: NFC-normalised, trimmed, 3–24 code points, letters
and digits of any script with single separators (space, `-`, `_`, `'`, `.`)
between them. The web form, the API transport validation and the API domain
(`PlayerName`) all apply the same function; PostgreSQL re-checks length and
trimming. Names are not unique; uniqueness is a product decision deferred to
the phase that shows names to other players (rankings, guilds).

### Provisioning

- Explicit and idempotent: `POST /player { displayName, characterName }`.
  Identity comes only from the verified token.
- One transaction: `INSERT … ON CONFLICT DO NOTHING` for the profile, read it
  back, `INSERT … ON CONFLICT DO NOTHING` for the slot-1 character, read it back.
  Under READ COMMITTED a concurrent transaction with the same unique key waits
  for the first to commit, then skips its insert and reads the committed row.
  The unique constraints make this correct without locks or retry loops.
- Existing rows are never modified: the first successful request's names win.
  The response is **201** when the call created something and **200** when the
  player already existed, with the same body shape.
- A profile without its main character (not reachable today, but possible
  after future partial deletions) is reported as not provisioned, and the next
  provisioning call repairs it.
- `GET /player/state` returns **404 `PLAYER_NOT_PROVISIONED`** for an
  authenticated account without a player; the client then shows onboarding.

### Ownership

The repository port offers no read by id alone. Character lookup is
`WHERE id = $1 AND profile.auth_user_id = $2`, and another player's character is
indistinguishable from a missing one (404 `NOT_FOUND`).

## Consequences

- Every future player-owned table references `profiles.id` or `characters.id`,
  never the Supabase id.
- Adding character slots, or a per-character progress table, needs no change to
  identity tables.
- Deleting a profile removes its characters. Deleting the Supabase user does
  **not** yet delete the profile (see alternatives); an account-deletion flow is
  required before launch.
- Concurrency safety rests on two unique constraints; they must not be dropped.

## Alternatives Considered

**Foreign key from `profiles.auth_user_id` to `auth.users(id)`.** Guarantees the
link at the database and could cascade deletion. Rejected for now: the `auth`
schema does not exist in local or CI PostgreSQL, so the migration would behave
differently per environment and Prisma's drift detection would diverge; and
deleting game data should go through an explicit, auditable account-deletion
flow rather than a silent cascade from the identity provider.

**Database trigger on `auth.users` insert to create the profile.** Couples game
schema to Supabase internals and cannot collect a display name. Rejected.

**Provision lazily inside `GET /player/state`.** Gives a GET side effects and has
no way to receive the chosen names. Rejected.

**Use the Supabase user id as the profile's primary key.** Spreads the identity
provider's identifier through every table. Rejected.

**Store derived stats (health, damage) on the character.** Creates a second,
stale truth after every balance change. Rejected.

**`is_main boolean` with a partial unique index instead of slots.** Works for
one main character but gives no natural key for further characters. Rejected
in favour of slots.
