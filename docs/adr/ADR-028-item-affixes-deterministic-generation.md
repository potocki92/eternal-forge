# ADR-028 — Item affixes and deterministic item generation

## Status

Proposed — 2026-09-25 (Phase 6, PR 6.2).

## Context

ADR-024 separates definitions from owned instances, ADR-026 awards persistent instances, and ADR-027 defines the canonical modifier pipeline. Items now need unique power without changing production combat or making mutable balance data authoritative for historical loot.

## Decision

### Terminology and catalog

An `ItemDefinition` remains a static archetype. An `AffixDefinition` is an immutable V1 generation rule. An `ItemInstance` is an owned copy and its `ItemAffixRoll` rows are immutable snapshots. Stable affix IDs and localization keys are durable content identities.

V1 has seven equal-weight affixes: flat Damage (10–25), additive Damage (300–900 bp), flat Max Health (25–80), additive Max Health (300–900 bp), additive Attack Speed (200–750 bp), flat Critical Chance (100–500 bp), and additive Critical Damage (300–1,000 bp). Ranges are inclusive integers; HugeNumber values use discrete whole units and rates/percentages use basis points. Explicit prefix/suffix families are deferred: unique definition IDs already prevent duplicates and families would add naming machinery without a generation constraint V1 needs.

Eligibility is data, never generator branching. Weapon is offensive-flexible; helmet health/critical; chest health with offensive utility; gloves offensive; boots health/speed utility; rings and amulets flexible. Every slot has at least five eligible definitions. Selection uses canonical catalog order, equal integer weights, sampling without replacement, and persisted positions.

### Rarity and generation

The one canonical budget is COMMON 0, MAGIC 1, RARE 2, EPIC 3, LEGENDARY 4, MYTHIC 5. Rarity changes count only; V1 ranges do not scale with rarity. Definitions have no intrinsic modifiers: a COMMON item is intentionally an equippable collectible baseline with zero power until a separately approved base-item design exists.

`ITEM_GENERATION_VERSION = 1`. The generator derives `deriveSeed(combatSeed, "item-affixes", 1, definitionId, rarity)` only after ADR-026 has determined drop, definition, and rarity. It cannot consume or perturb combat/item-drop RNG. V1 algorithms, catalog order, ranges and eligibility become immutable after release; future incompatible balance is V2 with new golden vectors.

### Persistence and snapshot semantics

`item_instances.generation_version` distinguishes legacy 0 from generated V1. Normalized `item_affix_rolls` stores UUID, owner item FK, definition ID, stat, operation, canonical string value, generation version and position. Unique `(item, position)` and `(item, definition)` constraints prevent ambiguous ordering and duplicates; deletion cascades. Values are authoritative snapshots: changing a future catalog never changes old power, and reads never reroll.

The migration deterministically marks all existing Phase 5 items version 0 with zero rolls. It performs no random backfill. Legacy items remain inventory/equipment-compatible and convert to zero modifiers.

Online combat creates the instance and all nested affix rows in the existing progression/combat transaction. Any failure rolls back everything. Existing combat idempotency and unique reward identity ensure retries read one item and its same rolls. COMMON with no child rows is complete. Inventory and equipment eager-load ordered rolls, avoiding N+1 queries.

### Modifier, API, replay, and security

Each persisted roll converts purely to the ADR-027 `StatModifier`, with the roll UUID as `source: { type: "AFFIX", id }`. Huge flat values parse as HugeNumber; rate and additive values parse as safe integer basis points. Malformed persistence fails at the trusted mapping boundary.

Item DTOs add `generationVersion` and ordered `affixes` (roll ID, definition ID, stat, operation, value and position); they do not expose ranges, weights or seeds. The Gear detail presents formatted results. Clients cannot submit any generation property and browser roles retain no table privileges.

Combat replay still reconstructs combat and ADR-026 reward identity, then reads the persisted item snapshot. It does not reconstruct historical item power from today's catalog. `GAME_RULES_VERSION` stays 2, combat output is unchanged, and equipment effects remain disabled until PR 6.3 defines snapshots/replay.

## Alternatives considered

- JSON affixes were rejected because relational uniqueness, ordering and validation matter.
- Deriving old values from current definitions was rejected because it retroactively changes loot.
- PostgreSQL/random migration backfill was rejected as irreproducible.
- Consuming the item-drop stream was rejected because it would alter committed loot vectors.
- Rarity-scaled ranges and intrinsic base power were rejected as premature inflation without telemetry.

## Consequences

Items are immutable historical power objects and can feed the shared modifier pipeline without redesign. More rows and a join are accepted; eager relation loading bounds queries. V1 balance must remain available forever. Combat integration, effective-stat snapshots and comparison/final-stats UI remain deferred to PRs 6.3 and 6.4.
