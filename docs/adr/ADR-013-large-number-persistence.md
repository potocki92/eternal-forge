# ADR-013 — Large-number persistence and ranking order

## Status

Proposed — decision required before Phase 1 completes.

## Date

2026-09-22

## Context

Eternal Forge is designed around effectively unlimited progression. Gold, damage
and other quantities will exceed `Number.MAX_SAFE_INTEGER`, and eventually
`bigint` becomes impractical for values that also need multiplication and
division in a hot loop. `docs/ARCHITECTURE.md` therefore calls for a single
`HugeNumber` abstraction, and `docs/DATABASE.md` explicitly flags that its
persistence format "must be deliberately designed".

Reviewing the documentation as a whole surfaced a second consequence that is not
yet recorded anywhere, and that is easy to discover too late:

**Redis sorted sets score members with an IEEE-754 double.** Phase 10 introduces
leaderboards on Redis sorted sets, and `docs/GAME_DESIGN.md` lists _Boss Damage_
as a ranking. A boss-damage value large enough to need `HugeNumber` cannot be
used as a sorted-set score without losing precision, so two players whose
damage differs by a meaningful margin can tie — or invert — in the ranking.

Highest Stage is unaffected: stages stay within integer range.

## Decision (proposed)

Three questions must be answered together, before Phase 1's `HugeNumber` lands,
because the arithmetic representation constrains both the storage format and the
ordering key:

1. **In-memory representation.** A normalised mantissa/exponent pair is the
   expected answer: constant-time arithmetic and no precision cliff.

2. **Storage format.** Candidates:
   - two columns (`numeric` mantissa + `integer` exponent) — sorts and compares
     in SQL, costs two columns per value;
   - PostgreSQL `numeric` — exact and sortable, but unbounded width and slower
     arithmetic at extreme magnitudes;
   - a canonical, lexicographically sortable text encoding — compact, but
     requires care to keep ordering correct across sign and exponent.

   Whichever is chosen must support ordering in SQL, because PostgreSQL is where
   leaderboard snapshots live.

3. **Ranking key.** For `HugeNumber`-valued leaderboards, the Redis sorted-set
   score should be a **monotonic projection** of the value — for example
   `log10(value)` scaled to the available precision — with the exact value kept
   in PostgreSQL and used to break ties on read. A projection preserves ordering
   at the granularity a ladder needs while the authoritative comparison stays
   exact.

## Consequences

- Deferring this past Phase 1 means either rewriting `HugeNumber`'s serialisation
  or migrating every persisted large value later.
- Any leaderboard over a `HugeNumber` quantity needs the exact value in
  PostgreSQL regardless of which projection is chosen; Redis holds the ordering,
  not the truth. This is consistent with ADR-006.
- Formatting stays separate from arithmetic: `HugeNumber` does mathematics, the
  UI layer renders `12.4K` / `5.28M` / scientific notation.

## Alternatives Considered

**Store large values as `float8`.** Rejected: silent precision loss in the
economy, which is the one place it is least acceptable.

**Use `bigint` everywhere.** Rejected: works for a while, then multiplication
cost and column width grow without bound, and division is awkward.

**Rank only on values that fit a double.** Rejected: it would remove Boss Damage
from the design, and `docs/GAME_DESIGN.md` makes multiple distinct ladders a
product requirement.

**Decide during Phase 10.** Rejected: by then every large value in the database
is already stored in whatever format Phase 1 happened to pick.
