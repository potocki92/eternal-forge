# ADR-031 — Active skill domain and deterministic cooldown model

## Status

Proposed — 2026-10-01 (Phase 7, PR 7.1).

## Date

2026-10-01

## Context

Phase 7 introduces active skills. docs/GAME_DESIGN.md names six candidates —
Whirlwind, Fireball, Execute, Blood Strike, Lightning Chain and Shield — and
asks for skill levels, modifiers and a cooldown architecture. None of their
gameplay (damage, cooldowns, effects) has been approved.

Four facts about the existing system constrain the design:

1. **Combat is resolved before it is shown.** `POST …/combats` runs
   `simulateCombat` on the server, commits the result and only then returns
   its event log; the browser plays that log back (ADR-019). Online
   auto-battle is a client loop over the same request (ADR-022), and offline
   progression simulates many fights in one claim (ADR-023). There is no
   real-time combat channel through which a player could act during a fight.
2. **Combat time is exact.** A side's `k`-th attack lands at exactly
   `k × 10 000 / attackSpeedBp` seconds; ordering cross-multiplies integers,
   and results report whole milliseconds (ADR-015). The time limit is
   `CombatRules.timeLimitMs`.
3. **History is versioned.** Persisted combats record `GAME_RULES_VERSION`
   and V3 combats snapshot the player's resolved stats, so a replay never
   consults current equipment or current balance (ADR-005, ADR-015,
   ADR-029). `RULES_V1`–`RULES_V3` are immutable.
4. **Numbers have conventions.** Values that scale with long-term power are
   `HugeNumber` (ADR-013); rates are integer basis points; durations are
   integer milliseconds. Game Core has no wall clock and no ambient
   randomness (ADR-002, ADR-005).

PR 7.1 is a pure Game Core foundation. It must let PR 7.2 (ownership, levels,
loadout persistence) and PR 7.3 (the deterministic combat runtime) build on it
without redesign, while changing no production behaviour.

## Decision

### Terminology

- **Active skill** — an ability a combatant uses during combat in addition to
  automatic attacks, subject to a cooldown. "Active" names its role in the
  combat model, not who triggers it (see "Manual vs automatic casting").
- **Skill definition** — the durable identity of a skill.
- **Skill tuning** — the balance of one skill: cooldown and level-scaled
  parameters.
- **Skill rules** — a validated set of tunings over one catalog.
- **Resolved skill** — one skill at one level with every value computed.
- **Cast** — one use of a skill at one instant of combat time.

### Skill identity

`SkillDefinitionId` is a validated value object: 1–64 lowercase letters,
digits or single underscores, starting with a letter — the same format as
`ItemDefinitionId` (ADR-024). It is a machine key, never a display name and
never derived from catalog order. Future persistence stores this string, so a
shipped identity is never renamed or reused.

### Catalog

`SkillDefinition` is identity only: `{ id, nameKey }`, with `nameKey` always
`skill.<id>.name`. `SkillCatalog` validates, rejects duplicate identities
(`DUPLICATE_SKILL_DEFINITION`), freezes its content, looks up in constant
time and reports unknown identities (`UNKNOWN_SKILL_DEFINITION`).
`SKILL_CATALOG` registers the six candidates: `whirlwind`, `fireball`,
`execute`, `blood_strike`, `lightning_chain`, `shield`.

Declaration order exists for review and presentation. **It is never a cast
priority.** Priority belongs to the player's loadout (PR 7.2) and is passed to
the activation policy explicitly.

Balance is deliberately not part of a definition. A definition must exist
before its gameplay is approved, and it must not change when the skill is
rebalanced. This is the same split as items: `ItemDefinition` is identity,
affix balance is versioned separately (ADR-028).

### Level model

`SkillLevel` is a value object holding a whole number from 1 to
`SKILL_LEVEL_MAX = 2^31 − 1`. No document defines a skill level cap, so none
is invented: the bound is the PostgreSQL `integer` range, the same structural
bound as `CHARACTER_LEVEL_MAX`. There is no level 0 — an unowned skill is
absent, not a level-0 skill. A per-skill content cap, if balance ever wants
one, is added to the tuning.

### Level resolution

A tuning describes every level-dependent value as a curve, never as per-level
branches:

- `IntegerLevelCurve` `{ base, perLevel }` → `base + perLevel × (level − 1)`,
  computed exactly with `bigint`, for milliseconds and basis points.
- `HugeNumberLevelCurve` `{ base, growth }` → `base × growth^(level − 1)`
  through `HugeNumber.pow`, the same form as character and stage scaling, for
  values that scale with long-term power. Never a JavaScript `number`.

`resolveSkillAtLevel(definition, level, rules)` is a pure function returning a
frozen `ResolvedSkill { id, level, cooldownMs, parameters }`. Curves are
validated when the rules are built (and must be legal at level 1); every value
is validated again at the level it is resolved for. A curve that leaves its
legal range fails with `OUT_OF_RANGE` (integers) or `OVERFLOW` (HugeNumber)
instead of being clamped. A known skill with no tuning in the rules is
`SKILL_UNAVAILABLE`.

The cooldown is a curve too (`perLevel: 0` for a constant), so a future
level-dependent cooldown needs no second cooldown system. No skill has
level-dependent cooldown balance today.

### Cooldown unit

Whole **milliseconds of combat time**: the unit `CombatEvent.timeMs`,
`durationMs` and `timeLimitMs` already use. Never floating-point seconds.

Integer milliseconds are commensurable with the exact attack timeline: a ready
time `R` ms precedes or equals the landing of attack `k` at speed `s` exactly
when `R × s ≤ k × 10 000 000`, an integer comparison. PR 7.3 can therefore
order casts and attacks without rounding.

Legal cooldowns are `1 ms` (`SKILL_COOLDOWN_MIN_MS`) to `2^31 − 1 ms`
(`SKILL_DURATION_MAX_MS`, about 24.8 days, so a resolved value fits an
`integer` snapshot column). **Zero is illegal**: a positive cooldown means a
skill casts at most once per instant, which bounds the casts of any
time-limited combat by `timeLimit / cooldown + 1` per skill.

### Cooldown boundary semantics

These become historical gameplay semantics the moment a skill affects a
persisted combat:

- **Initial readiness:** every skill is ready at combat time 0. An opening
  delay is not modelled; if one is wanted it becomes tuning data.
- **Cast:** instantaneous. Its cooldown **starts at the cast instant**: cast
  at `t` with cooldown `c` → `nextReadyAtMs = t + c`.
- **Readiness:** inclusive — ready at `t` exactly when `t ≥ nextReadyAtMs`.
  Cooldown 5 000 ms cast at 1 000 ms: not ready at 5 999 ms, ready at
  6 000 ms. Each cooldown counts from its own cast, not from the previous
  ready time.
- A cast before readiness is refused (`SKILL_NOT_READY`); a ready time beyond
  the safe-integer range is refused (`OUT_OF_RANGE`).

### Combat-time semantics

`SkillCooldownState { skillId, nextReadyAtMs }` is per combat and lives only
inside a simulation. Combat time is a non-negative safe integer
(`validateCombatTimeMs`). No cooldown function accepts or stores a `Date`, an
ISO timestamp, a Unix time, network latency or animation time. Browser
playback later follows recorded events; it never decides readiness.

### Server authority

Only the server's simulation decides whether and when a skill is cast. The
client will configure skills (a loadout and its priority, PR 7.2) as an
authenticated command whose result is persisted; it never reports a cast, a
cooldown, a damage value or a level.

### Manual vs automatic casting

**Decision: the first skill runtime is deterministic automatic casting.**
Inside `simulateCombat`, a policy casts the player's equipped skills when they
are ready (and, later, when their conditions hold) in the player's priority
order. The player's control is pre-combat configuration, which becomes part of
the combat input and its snapshot.

**Real-time manual casting is deferred and must not be faked.** Online combat
is resolved before playback, so a button pressed during playback could not
change an already-committed result; offline claims and auto-battle have no
player present at all. Manual casting would need a different authoritative
execution model — combat that advances on the server as commands arrive, with
its own persistence, pacing and anti-cheat design — and its own ADR. Nothing
in this foundation precludes it: a cast is "a skill becomes eligible and a
decision selects it at an instant", and only the source of the decision would
change.

### Eligibility and the activation-policy boundary

`evaluateSkillCast({ skill, cooldown }, combatTimeMs)` returns
`{ eligible: true }` or `{ eligible: false, reason: 'ON_COOLDOWN',
readyAtMs }`. A resolved skill already proves the skill exists and its level
is valid. The result is a discriminated union over an explicit reason list, so
future conditions (enemy or hero health thresholds, resources, targets) are
new reasons, not a redesign.

`selectSkillActivation(candidatesInPriorityOrder, combatTimeMs)` is the
initial policy shape for one instant: the first eligible candidate in the
order the caller supplies, or `null`. It refuses a skill listed twice. It does
not schedule instants, decide ties between a cast and an attack at the same
instant, or decide how many casts one instant allows; those are PR 7.3
decisions.

### Effect boundary

No effect is approved, so none is modelled. A tuning carries named,
unit-typed **parameters** — `HUGE_NUMBER`, `BASIS_POINTS` (0 … 2^53 − 1) or
`MILLISECONDS` (0 … 2^31 − 1) level curves, names in lowercase snake case,
sorted canonically — and resolution produces their values. The effect *kind*
(what a parameter does in combat) is added by the runtime that executes it,
which also declares which parameters each kind requires. This is the smallest
typed extension point that can carry Fireball's damage, Execute's threshold
or Shield's duration later without pretending their semantics now.

Known limits that a later design must address explicitly:

- **Single target.** Combat is one hero against one enemy. Whirlwind and
  Lightning Chain are multi-target ideas; their first implementation needs a
  single-target interpretation or must wait for multi-target combat. Nothing
  here fakes multiple targets.
- **Shield.** Combat models health and direct damage only. A shield needs a
  defensive-effect design (absorb, duration, interaction with health). It is
  not mapped to Max Health and no shield resource is introduced.
- **Not every skill is a stat modifier.** A skill that changes a character
  stat for a duration may use the ADR-027 `StatModifier` pipeline (source type
  `SKILL` already exists); a direct-damage skill is an action, not
  "+X% Damage".
- **Combat events.** `CombatEvent` is unchanged. A skill-enabled combat will
  need new event kinds (for example a cast and its hit); PR 7.3 adds them under
  a new rules version so V1–V3 fingerprints stay byte-identical.

### Numeric representation

HugeNumber for power-scaled parameters, integer basis points for percentages,
integer milliseconds for durations and cooldowns. Integer curves are evaluated
with `bigint` and range-checked before conversion back to `number`; no
floating point decides a value.

### Determinism and RNG

Every function is pure: identical inputs give identical, byte-identical
results (the JSON of a resolved skill is a stable fingerprint). Nothing in this
foundation draws from an RNG and no combat RNG stream is consumed. A future
random skill effect must draw from an explicitly derived stream
(`deriveSeed`) whose label and consumption order are recorded in its rules
version, so adding skills cannot shift the critical-hit stream of existing
combats.

### Versioning

- **Identity** (definitions, catalog) is not versioned: like
  `ItemDefinitionId`, an identity is permanent and additive.
- **Tuning** that affects combat is versioned **with the combat rules**. When
  PR 7.3 lets skills affect combat, the skill rules become part of a new
  `GameRules` version (`RULES_V4`, `GAME_RULES_VERSION` 4); every later
  rebalance is another rules version. `RULES_V1`–`RULES_V3` gain no skills:
  no historical combat contained one.
- No separate `SKILL_RULES_VERSION` is introduced. `ITEM_GENERATION_VERSION`
  exists because an item is generated once and persisted independently of
  any combat; a skill's effect exists only inside a combat, whose version
  already names the rules it ran under.
- PR 7.1 therefore changes nothing that executes: `GAME_RULES_VERSION` stays
  3 and no `SkillRules` value is registered in any `GameRules`.

### Replay

A skill-enabled `CombatRun` must be replayable without consulting the
character's current skill levels, current loadout, current balance or any
wall clock. PR 7.3 must therefore snapshot, per combat, the loadout in
priority order with each skill's identity and level (or its resolved values),
alongside the existing ADR-029 stat snapshot, and resolve the tuning from the
recorded rules version.

### Persistence policy

None in PR 7.1: no table, column, migration or endpoint. Skill ownership,
levels and the loadout are PR 7.2. When persisted, a skill is its
`SkillDefinitionId` string and a `SkillLevel` integer; definitions and tuning
stay static Game Core content, as item definitions do.

### Package ownership

Everything lives in `packages/game-core/src/skills` and is exported from the
package root. It depends only on Game Core (`HugeNumber`, `GameCoreError`)
and remains covered by the purity guard: no framework, persistence, browser
API, environment variable or clock.

## Consequences

- PR 7.2 can persist ownership, levels and loadouts as `SkillDefinitionId` +
  `SkillLevel` + priority order with no change to these types.
- PR 7.3 can add a scheduler that walks combat time, calls
  `selectSkillActivation` and `startSkillCooldown`, and adds effect kinds
  over the resolved parameters — under `RULES_V4`, leaving every existing
  golden fingerprint untouched.
- The six candidates exist as identities with no gameplay; resolving one under
  production rules is impossible until its tuning is approved, which makes an
  accidental unapproved effect a visible error rather than a silent default.
- Four error codes are added (`UNKNOWN_SKILL_DEFINITION`,
  `DUPLICATE_SKILL_DEFINITION`, `SKILL_UNAVAILABLE`, `SKILL_NOT_READY`). No
  API maps them yet.
- Parameters are looked up by name, so a typo between tuning and a future
  effect is a runtime error at rules construction rather than a compile error.
  PR 7.3 contains it by validating each effect kind's required parameters when
  the rules are built.

## Alternatives Considered

**Balance in `SkillDefinition` with provisional numbers for the six
candidates.** Rejected: it invents unapproved balance, and rebalancing would
change an object that persistence and history refer to.

**Skill tuning inside `RULES_V3` now.** Rejected: it would claim that V3
combats had skills, and adding data to a historical rule set is the silent
history rewrite ADR-015 forbids.

**A separate `SKILL_RULES_VERSION`.** Rejected: skill effects exist only in
combat, which is already versioned; two versions for one combat would allow
contradictory pairs.

**Floating-point seconds for cooldowns.** Rejected: binary fractions would
decide readiness and break exact ordering against the attack timeline.

**Wall-clock cooldowns (`Date`, timestamps).** Rejected: replay would depend
on when it runs, and a client clock could influence a result.

**Zero-millisecond cooldowns.** Rejected: unbounded casts at one instant.

**Exclusive readiness (`t > nextReadyAt`).** Rejected: a 5 000 ms cooldown
would behave as 5 001 ms, and the error grows with every cast.

**Manual casting through a playback-time button.** Rejected: it would change
nothing (the combat is already committed) or require trusting a client claim.

**A general effect system now** (bleed, burn, stacks, resources, triggers).
Rejected: no mechanic is approved, and an engine designed before its first
consumer tends to fit none.

**A `SkillLevel` content cap of 100.** Rejected: not in any design document;
an arbitrary cap would need a migration to lift.

## Deferred work

- **PR 7.2 — Skill ownership, levels and loadout persistence:** owned skills,
  how a skill is acquired and levelled (and what it costs), loadout size and
  priority order, migration, authenticated API, ownership checks and
  concurrency through `characters.version`.
- **PR 7.3 — Deterministic skill combat runtime:** the scheduler over combat
  time, cast/attack tie rule, casts per instant, effect kinds and their
  required parameters, new combat events, `RULES_V4`, per-combat skill
  snapshots for replay, RNG stream labels, and the decision for offline
  progression (which today uses level-only stats, ADR-029 §9).
- **PR 7.4 — Initial active skills and player UI:** approved tuning for the
  first skills, a Skills screen and loadout editor, and presentation of
  recorded casts in combat playback.
- **Later:** real-time manual casting (needs its own ADR), multi-target
  combat, the defensive-effect model for Shield, and equipment that modifies
  skills.
