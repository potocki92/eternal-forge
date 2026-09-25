# ADR-027 — Character stats and modifier pipeline

## Status

Proposed — 2026-09-24 (Phase 6, PR 6.1).

## Context

Combat currently receives `CombatStats` containing health, damage, attack
speed, critical chance and critical damage. Player health and damage derive
from level through versioned character rules; the remaining values come from
the level-one rule data. Enemy health/damage derive from stage and archetype
data. Attack speed determines an exact rational timeline, critical chance
selects one deterministic RNG outcome per attack, and critical damage scales a
critical hit. There is no armor or other mitigation formula.

Phase 6 needs equipment, affixes and later skills/effects to contribute power
without teaching Combat where each value originated. A generic pipeline must
remain deterministic at idle-game magnitudes, preserve historical replay, and
avoid persisting derived values that can become stale.

## Decision

### Stat taxonomy

The initial stable IDs are `MAX_HEALTH`, `DAMAGE`, `ATTACK_SPEED`,
`CRITICAL_CHANCE` and `CRITICAL_DAMAGE`. They map exactly to current player
combat inputs. Armor is deferred until mitigation semantics exist. Bleed,
poison and elemental damage are combat effects, not scalar character stats,
and are also deferred.

### Numeric model

Max Health and Damage use immutable `HugeNumber` values with 18 significant
decimal digits. Attack Speed, Critical Chance and Critical Damage use safe
integer basis points. 10,000 basis points means 100%; for Attack Speed it also
means one attack each second. A percentage modifier uses signed integer basis
points, so its precision is 0.01%. Arbitrary binary floating point is rejected.

### Base derivation

`deriveBaseCharacterStats(level, rules)` is pure and accepts its immutable Game
Rules explicitly. It reproduces the existing level formulas: level-one base
health/damage multiplied by their per-level growth to `level - 1`, while the
three rate values come directly from rule data. It performs no persistence,
network, clock, randomness or framework work.

### Modifier model

A `StatModifier` contains a stable stat ID, an operation, a typed value and a
source `{ type, id }`. Supported operations are:

1. `FLAT`: `HugeNumber` for Max Health/Damage, integer basis points for rate
   stats.
2. `ADDITIVE_PERCENT`: signed integer basis points for every stat.

Source types initially reserve the concrete integration vocabulary
`ITEM_INSTANCE`, `AFFIX`, `SKILL`, `BUFF`, `DEBUFF` and `PASSIVE`. The resolver
does not branch on source type. Metadata exists for canonical ordering,
diagnostics and a future UI breakdown.

### Resolution order and determinism

Resolution is `BASE -> FLAT -> ADDITIVE_PERCENT -> CLAMP`. All flat terms form
the subtotal. Percentage terms form one additive pool and multiply that
subtotal once. There is no separate multiplicative-stack operation because no
approved mechanic currently needs one.

The resolver copies and sorts matching modifiers by the explicit stat order,
operation order, source-type order, source ID and canonical value. Database
order, object property order and caller insertion order are irrelevant.
Duplicate equal modifiers remain duplicate multiset members. Equal base values
and equal modifier multisets therefore produce structurally equal results.

### Rounding and clamps

All integer division rounds half to even. `HugeNumber` already enforces this;
the rate resolver implements the same rule with exact `bigint` intermediates.
No component may choose a different rounding mode.

After percentage application, Max Health clamps to at least one, Damage to at
least zero, Attack Speed to at least one basis-point unit, Critical Chance to
0–10,000, and Critical Damage to at least 10,000. A rate beyond the JavaScript
safe-integer range is rejected. Combat's versioned maximum attack speed remains
a Combat cap rather than a universal character-domain maximum.

### Versioning

`GAME_RULES_VERSION` remains 2. This foundation is unused by production combat
and changes no outcome. Base derivation accepts a `GameRules` value so future
versioned balance remains explicit. When equipment begins affecting persisted
combat in PR 6.3, the effective source/snapshot and replay policy must be
versioned before release; old rules must not be edited.

### Persistence policy

Base and resolved stats are derived and are not stored in PostgreSQL. Only
authoritative source state (currently level, later affix rolls or other source
data) should persist. PR 6.1 requires no database migration and introduces no
API DTO.

### Package ownership

Identifiers, modifier types, derivation and resolution live in pure
`packages/game-core`. They have no Prisma, NestJS, React, browser or transport
dependency. Combat continues to consume final numeric values and never needs
item, affix, buff or skill special cases.

## Alternatives considered

**Add Armor now.** Rejected: there is no current mitigation formula, so its
range and semantics would be speculative.

**Use floating-point percentages.** Rejected: binary fractions would weaken
authoritative determinism and permit ambiguous precision.

**Apply modifiers in caller order.** Rejected: repository/query ordering and
array construction would become hidden gameplay inputs, and HugeNumber
rounding can expose a different addition sequence at extreme magnitudes.

**One resolver per source system.** Rejected: item, skill and buff mathematics
would drift and Combat would regain source-specific branches.

**Persist resolved stats.** Rejected: they are derived values that could become
stale after progression, rules or equipment changes.

**Add multiplicative/exotic operations now.** Rejected: flat and an additive
percentage pool satisfy the concrete foundation. New operations require clear
semantics, ordering and versioning when a real mechanic needs them.

## Consequences

Future affixes, buffs and passives can translate directly to a common
`StatModifier[]`. The source metadata remains available for explanation while
the resolved output is source-agnostic. Large values preserve HugeNumber
semantics and rates remain exact fixed point. Callers must supply canonical,
stable source IDs and handle explicit invalid/out-of-range errors.

## Deferred work

- PR 6.2: item power, affix definitions/generation and persisted rolled source
  state.
- PR 6.3: equipped-item modifier collection, combat snapshots, replay
  compatibility and enabling equipment combat effects.
- PR 6.4: player-facing final stats and source breakdown UI.
- Armor/mitigation, status effects and any distinct multiplicative operation.
