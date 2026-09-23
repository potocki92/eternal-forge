# ADR-013 — Large-number persistence and ranking order

## Status

Accepted — 2026-09-22.

History, kept because ADRs are append-only:

1. Proposed on 2026-09-22 with three open questions ("Decision (proposed)").
2. A concrete recommendation with six open questions was added the same day
   ("Recommendation").
3. The user approved the recommendation on 2026-09-22 and answered all six
   questions. The answers are recorded in "Final decision" below. Where the
   final decision is more specific than the recommendation, the final decision
   wins.

## Date

2026-09-22

## Final decision (accepted 2026-09-22)

The recommendation below is adopted as written, with these answers to its open
questions:

1. **Precision — APPROVED.** 18 significant decimal digits. Integers up to
   `10^18 − 1` are exact.
2. **Range — APPROVED.** Signed 32-bit scientific exponent. Overflow above
   `2^31 − 1` is a deterministic error, never `Infinity`. Values below the
   smallest exponent flush to zero; there are no subnormals. The exponent
   `−2^31` is reserved as the zero sentinel.
3. **Storage — APPROVED.** Two columns, `<name>_coef bigint` and
   `<name>_exp integer`, with the `CHECK` constraint in section 3. SQL does no
   arithmetic on these values.
4. **Package edges — APPROVED, with a boundary.** `packages/contracts` may depend
   on `packages/game-core` for the pure `HugeNumber` value type and its
   canonical serialisation. `apps/web` may use only pure representation
   operations of `HugeNumber`: parsing, serialisation, comparison and the data
   a formatter needs. This does **not** permit gameplay logic in the frontend.
   Combat, rewards, progression and the economy stay server-authoritative
   (ADR-003). Formatting (`12.4K`, `5.28M`) remains presentation code in the UI
   layer (docs/UI_SYSTEM.md).
5. **Ledger — APPROVED.** A signed quantity is persisted as a non-negative
   magnitude plus a direction. The current balance may be stored as state; the
   ledger is the auditable history. Replaying the ledger through `HugeNumber`
   is a reconciliation and audit procedure. It is **not** run on ordinary
   requests.
6. **Tooling — APPROVED.** `fast-check` is a devDependency of
   `packages/game-core`.

### Implemented in Phase 1

- The in-memory representation, arithmetic (`add`, `sub`, `mul`, `div`, integer
  `pow`, `floor`), comparison, the canonical string and the two-part
  `toParts`/`fromParts` form the persistence columns will map to
  (`packages/game-core/src/huge-number`).
- Golden vectors whose expected values come from an independent oracle,
  Python's `decimal` module at 18 digits with `ROUND_HALF_EVEN`, rather than
  from the implementation under test. Changing a vector is a rules change.
- Property tests with `fast-check` against an independent exact reference
  implementation.

### Deferred to the phase that first needs it

- **Zod wire schema in `packages/contracts`.** Added with the first endpoint
  that carries a `HugeNumber` (Phase 2 or 3). Game Core already exports
  `HugeNumber.isCanonical`, so the schema will be a thin wrapper with no
  duplicated format rules.
- **PostgreSQL columns and the `ORDER BY` integration test.** Added with the
  first table that persists a `HugeNumber`.
- **Redis integer score projection (section 5).** Added with the first
  `HugeNumber`-valued leaderboard (Phase 10 at the earliest). The formula in
  section 5 is the accepted design.
- **Fractional powers, `log10` and `sqrt`.** Added, in integer arithmetic, when
  the first mechanic needs them.

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

## Recommendation (2026-09-22) — accepted, see "Final decision"

This section refines "Decision (proposed)" above into a concrete design. It does
not replace it: the three questions and the projection principle still hold. It
changes one expectation. The mantissa should be **decimal and integral**, not a
binary floating-point number. The reasons are under "Why not a binary
mantissa" below.

### 1. In-memory representation

`HugeNumber` is an immutable value `sign × c × 10^(e − 17)`, where:

- `c` is a `bigint` coefficient with **P = 18** significant decimal digits,
  normalised so that `10^17 ≤ c < 10^18`. Zero is the single value `c = 0`.
- `e` is the **scientific exponent** (`1500` → `e = 3`), bounded to the signed
  32-bit range. The lowest value, `−2^31`, is reserved for zero.
- Every operation whose exact result needs more than 18 digits rounds
  **half-to-even**. The rounding happens once, at the end of the operation, and
  that rule is part of the game rules (ADR-005).
- An exponent above the bound is a deterministic overflow error. It is never
  `Infinity`. An exponent below the bound rounds to zero.

What this gives:

- Every integer up to `10^18 − 1` is exact. That is 100× above
  `Number.MAX_SAFE_INTEGER` and covers the whole early and mid-game economy with
  no rounding at all. `1,234,567 + 1` is `1,234,568`, not `1234567.9999999998`.
- Beyond that, values carry 18 significant digits. A `float64` mantissa carries
  15–17.
- Values up to about `10^2,147,483,647`. No realistic stage-scaling curve reaches
  that.
- Every operation is `bigint` addition, multiplication, division and comparison
  with an explicit rounding step. The ECMAScript specification defines all of
  these exactly. No `Math.*` function is involved.

Values from content data, such as a multiplier of `1.07`, enter as decimal
strings and are parsed exactly. `HugeNumber.fromNumber` accepts only safe
integers, so a binary float never becomes an authoritative value by accident.

### 2. Canonical serialisation

The value crosses JSON, logs and fixtures as a **canonical string**. It is never
a JSON number, and it is never a `bigint`, which JSON cannot carry.

```
zero      → "0"
otherwise → -?D(.F)?eX
  D  one digit 1–9
  F  0–17 digits, not ending in 0
  X  0, or a signed integer with no leading zeros and no "+"
regex     ^(?:0|-?[1-9](?:\.[0-9]{0,16}[1-9])?e(?:0|-?[1-9][0-9]*))$
examples  1500 → "1.5e3"   5 → "5e0"   0.25 → "2.5e-1"
          123456789012345678901 → "1.23456789012345679e20"
```

Each value has exactly one string, so equality of serialised values means
equality of values. `parse` accepts only the canonical form, and
`serialize(parse(s)) === s` holds by construction. The form is valid input to
`Number()`, PostgreSQL `numeric` and most tools, and a person can read it.

`packages/contracts` exposes the wire type as a Zod string schema, with the
format owned by Game Core. The open questions below cover the new package edge
this implies.

### 3. PostgreSQL storage

Each persisted `HugeNumber` uses **two columns**. They are the normalised
representation itself:

```
<name>_coef  bigint   NOT NULL   -- c, 18 digits, or 0
<name>_exp   integer  NOT NULL   -- e, or −2147483648 for zero
CHECK ( (<name>_coef = 0 AND <name>_exp = -2147483648)
     OR (<name>_coef BETWEEN 100000000000000000 AND 999999999999999999
         AND <name>_exp > -2147483648) )
```

- Persisted `HugeNumber` values are **non-negative** by constraint. That covers
  every resource, damage total and ranking metric. A signed quantity, such as a
  ledger entry, stores a non-negative magnitude plus a `direction` column. This
  is the usual ledger practice and needs no signed encoding.
- **Ordering is `(exp, coef)` lexicographic**, which is exactly numeric order
  for non-negative values. A plain composite B-tree index serves top-N reads and
  `ORDER BY … DESC` directly.
- Prisma maps `bigint` to a JS `bigint` and `integer` to a `number`, both
  natively. `numeric` and Prisma's `Decimal` are not involved. The repository
  layer maps the two columns to and from `HugeNumber`, as ADR-004 requires for
  every persistence model anyway.
- Storage is 12 bytes and the wire size is constant at any magnitude.

A consequence to accept deliberately: **SQL cannot do arithmetic on these
columns.** `SUM(amount)` over a ledger is not available. Above `10^18`, no
bounded-precision format could make it exact anyway: the balance is the result
of a sequence of rounded operations. Ledger reconciliation therefore replays the
entries through `HugeNumber` in their recorded order, and determinism makes
that reproducible. Below `10^18` the replay is exact.

### 4. Comparison and sorting

- In memory, `compare(a, b)` checks sign, then exponent, then coefficient. It
  is exact and total. `equals` is structural because the representation is
  canonical.
- In SQL, ordering is by `(exp, coef)` as above.
- Ties on the exact value are broken by `achieved_at`, earlier first, then by
  the player's id. This makes every ranking a strict total order, and the order
  can be reproduced from PostgreSQL alone.

### 5. Redis leaderboards over a `HugeNumber`

The sorted-set score is an **integer projection** built without a logarithm.
For a non-negative, integer-valued metric:

```
score(0) = 0
score(v) = (e + 1) · 10^6 + floor(c / 10^12)        for v ≥ 1
```

- It is non-decreasing in `v`. It is exact, because it is an integer below
  `2^53`: the maximum is about `2.15 × 10^15`. It keeps the exponent and the
  first six significant digits.
- The general rule: choose the digit count `D` so that
  `(E_max + 2) · 10^D < 2^53`. With the full 32-bit exponent, `D = 6`. A ladder
  whose metric is known to stay below a smaller exponent may use more digits.
- Two players collide only when they share the exponent and the first six
  digits. The read path fetches the requested page widened to whole
  equal-score groups at both boundaries. It then orders those groups by the
  exact `(exp, coef, achieved_at, id)` from PostgreSQL.
- Integer-range ladders such as Highest Stage use the raw value as the score.
  _Qualified by ADR-018:_ stages are exact up to 2^63 − 1, but a score is exact
  only up to 2^53, so Phase 10 must bound the stage or use a projection.
- Redis still holds only the ordering, never the value (ADR-006). A lost sorted
  set is rebuilt from PostgreSQL.

### 6. Determinism across backend, worker and tests

- `HugeNumber` arithmetic uses only `bigint` operations with specified results
  and a single, explicit rounding rule. It is bit-identical across Node
  versions, operating systems, Vitest workers and browsers.
- **Golden vectors.** `packages/game-core` commits a fixture of
  `(operation, a, b) → canonical result` covering rounding boundaries, carries,
  exponent overflow and underflow, and zero. If any vector changes, that is a
  rules change. It requires a `GAME_RULES_VERSION` bump and is reviewed as one.
- **Invariant tests:**
  - canonical round-trip;
  - `compare` agrees with `(exp, coef)` ordering;
  - the Redis score never contradicts `compare`;
  - the usual algebraic properties, where rounding permits them.

  A property-testing library (`fast-check`) would be a new devDependency and is
  listed below for approval.
- **One integration test against real PostgreSQL** in the backing-services job.
  It writes values across the whole range and asserts that `ORDER BY` agrees
  with `compare`.
- Integer powers use square-and-multiply with a fixed rounding schedule. That
  algorithm is part of the rules. Fractional powers, `log10` and `sqrt` are
  implemented deterministically in integer arithmetic when the first mechanic
  needs them, not before. Where their result is authoritative, they never
  delegate to `Math.pow`, `Math.log10` or `Math.exp`: the specification allows
  those to be implementation-approximated.
- A Phase 1 micro-benchmark records throughput for `add` and `mul`. If it falls
  short of what the simulation needs, the fix is an optimisation inside the
  representation, such as skipping renormalisation on hot paths. The semantics
  above do not change.

### Why not a binary mantissa

A normalised `float64` mantissa with an integer exponent is the idle-genre
default, as in `break_infinity.js`. It is fast. It is the wrong trade here, for
three reasons:

- It makes small integers inexact once normalised, and those are the values
  players read most closely.
- It makes a ledger disagree with the balance it records.
- Its normalisation step relies on `Math.log10` and `Math.pow`, which the
  language does not require to be identical across engines or versions.

The project ranks correctness and auditability above raw speed (CLAUDE.md —
"Development philosophy").

### Alternatives considered for this recommendation

**`decimal.js` wrapped behind `HugeNumber`.** Viable, and the fallback if
hand-written transcendental functions prove costly. It is deterministic and
already ships deterministic `ln`, `exp` and `pow`. It is not preferred for three
reasons:

- It would be Game Core's first runtime dependency.
- Its precision and rounding are global mutable configuration, isolated only
  through `Decimal.clone()`.
- Its arbitrary-length digit arrays are more machinery than an 18-digit
  coefficient needs.

The public API, serialisation and storage above do not depend on this choice.

**PostgreSQL `numeric` in a single column.** Exact, orderable and summable in
SQL. The costs:

- A hard ceiling near `10^131072`.
- A text wire format that grows linearly with the exponent. `1e100000` is
  returned as a 100,001-character string on every read.
- Conversion through Prisma's `Decimal`.

This is the right choice only if SQL-side arithmetic is judged worth those
costs.

**A lexicographically sortable text encoding.** Rejected. Its correctness
depends on collation (`COLLATE "C"`) and on fixed-width exponent encoding
surviving every future change, and it supports no arithmetic.

**`log10(value)` as a `double` score.** Rejected in favour of the integer
projection. It has about the same collision rate at large exponents, it depends
on `Math.log10`, and it is harder to specify and test exactly.

### Open questions for the user

Answered on 2026-09-22 (see "Final decision"). The questions were:

1. **Precision.** Is 18 significant digits acceptable? That means exact integers
   up to `10^18 − 1`, and a coefficient that fits `bigint` in both JS and
   PostgreSQL.
2. **Range.** Is a 32-bit scientific exponent acceptable, meaning values up to
   about `10^2,147,483,647`, with overflow as a hard error?
3. **Storage.** Two columns (`bigint` + `integer`), rather than `numeric`,
   accepting that SQL cannot do arithmetic on these values?
4. **Package edges.** May `packages/contracts` and `apps/web` depend on
   `packages/game-core` for the value type? Game Core has no runtime
   dependencies, so nothing leaks. The alternative is duplicating the canonical
   regex, guarded by a cross-check test.
5. **Ledger.** Store a non-negative magnitude plus a direction, and reconcile by
   deterministic replay rather than `SUM`?
6. **Tooling.** Add `fast-check` as a devDependency of `packages/game-core`?

## Consequences

- Every gameplay quantity that can grow without bound is a `HugeNumber`. No
  module implements its own large-number arithmetic.
- `HugeNumber` results are bit-identical across Node versions, operating systems
  and browsers, because they use only `bigint` operations the language specifies
  exactly. The rounding rule and the `pow` algorithm are part of the game rules:
  changing either requires a `GAME_RULES_VERSION` bump (ADR-005).
- Arithmetic is slower than a `float64` mantissa. The Phase 1 benchmark records
  the cost. Correctness and auditability rank above raw speed.
- Persisted values are non-negative by constraint. Signed ledger entries store
  magnitude plus direction.
- SQL cannot sum these columns. Reconciliation replays the ledger in
  `HugeNumber`, as an audit procedure and not on ordinary requests.
- `packages/contracts` and `apps/web` gain an allowed edge to
  `packages/game-core`, limited to the pure value type. Game Core has no runtime
  dependencies, so the edge brings no transitive framework or infrastructure
  code with it.
- The decision was taken before Phase 1 completed, so no persisted value has to
  migrate.
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
