# ADR-024 — Item domain model and static catalog

## Status

Proposed — 2026-09-23 (Phase 5, PR 5.1).

## Date

2026-09-23

## Context

Phase 5 will eventually add inventory, equipment, drops and persistence. Its
foundation needs identities and source-state rules before those outer systems
exist. Items are gameplay objects, but PR 5.1 must not make the browser,
database or transport authoritative, add randomness, or change combat. The
model also needs to leave a typed additive seam for Phase 6 affixes without
inventing that system now.

## Decision

### 1. Definitions and instances are separate

An `ItemDefinition` is immutable static content: `id`, `nameKey` and `slot`.
An `ItemInstance` is one uniquely identifiable item: `id`, `definitionId` and
`rarity`. Multiple instances may reference one definition. The instance never
duplicates its definition's slot or display metadata.

### 2. Stable definition identity

`ItemDefinitionId` is a value object whose canonical representation is 1–64
lowercase ASCII letters/digits separated by single underscores, beginning with
a letter (for example `forged_iron_sword`). It is independent of array order,
human-readable, safe as a future database key, and serializes as that string.
An ID is permanent: it is never renamed or reused for a different concept.

Changing display text changes localization content, not identity. If a concept
is truly replaced, it receives a new ID; the old definition remains resolvable
while any persisted instance references it. Definitions cannot simply be
removed after issuance. Deprecation/tombstone policy belongs to the persistence
PR, but resolution compatibility is mandatory.

### 3. Instance identity is supplied, not generated

`ItemInstanceId` accepts a canonical lowercase RFC 4122/RFC 9562-style UUID
with a valid version (1–8) and variant. Game Core never creates it. A future
server application/infrastructure boundary will generate globally unique IDs
using its CSPRNG and pass a validated value into Game Core. IDs serialize as
canonical UUID strings.

### 4. Slots

The only slot values are `WEAPON`, `HELMET`, `CHEST`, `GLOVES`, `BOOTS`,
`RING` and `AMULET`. These uppercase strings are the canonical domain,
persistence and wire representation. An equip rule in PR 5.2 will resolve the
instance's definition and use that single slot; callers cannot supply a second,
contradictory instance slot.

### 5. Rarity belongs to the instance

The only rarity values are `COMMON`, `MAGIC`, `RARE`, `EPIC`, `LEGENDARY` and
`MYTHIC`. These uppercase strings are canonical on the wire and in future
persistence. Their order is one explicit rank table, Common through Mythic; it
does not depend on spelling, declaration order or numeric-enum behavior.

Rarity is instance-level source state. Therefore two Iron Sword instances may
be Common and Legendary without multiplying static definitions. In PR 5.1
rarity is classification and ordering only: it grants no stats, multiplier,
affix count or effect. A future fixed-rarity unique-item policy can constrain
construction without changing the identity split.

### 6. Source state and derived state

Instances contain only instance ID, definition ID and rarity. Name key and
slot are derived by catalog lookup. Display text, stats, ownership, equipped
state, quantities, durability, binding and item power are absent. This prevents
states such as a sword instance claiming a helmet slot and keeps future rows
compact.

The canonical serialized instance is an object with three strings:
`{ id, definitionId, rarity }`. Explicit parse/serialize helpers validate the
boundary and round-trip it without JavaScript object identity.

### 7. Catalog architecture and immutability

One `ItemCatalog` validates definitions on construction, rejects duplicate
IDs immediately, freezes definition values and its deterministic iteration
view, and keeps a private `Map` for effectively constant-time lookup. Callers
cannot access or mutate the map. The initial catalog deliberately contains one
definition for each slot: Forged Iron Sword, Emberguard Helm, Ashsteel Cuirass,
Smith's Gauntlets, Cinderwalk Boots, Runed Iron Ring and Forgeheart Amulet.

Definitions use stable `item.<definition_id>.name` content keys. This does not
create a localization system or make English text identity.

### 8. Rules and content evolution

The initial catalog is static content outside `RULES_V1`. Adding a definition
that no historical computation references does not change combat and therefore
does not require a `GAME_RULES_VERSION` bump. PR 5.1 leaves version 1 and its
golden fingerprints untouched.

Balance data that later affects deterministic simulation must be versioned with
the rule/content input recorded by that simulation; it must not silently mutate
historical outcomes. Before such data is added, a later ADR must decide whether
it lives in a new game rule set or a separately versioned immutable content
registry. Old versions/definitions must remain available while historical runs
or persisted instances reference them. Definition IDs are never reused.

### 9. Extension seams

Phase 6 may add a typed collection of rolled affix/effect source values to the
instance and its serializer. PR 5.1 adds no `any[]`, `unknown[]` or placeholder.
PR 5.2 may store instance source state and ownership, then derive the legal
equipment slot through the catalog. PR 5.3 may select definition and rarity
using deterministic server-owned inputs, obtain an ID at the outer boundary,
and call the same validated constructor. None may bypass catalog validation.

### 10. Persistence, API and authority boundaries

There is no migration, repository, contract, endpoint or UI in PR 5.1. Future
infrastructure maps the canonical strings to PostgreSQL/Prisma; persistence
models and API DTOs remain distinct from domain objects.

The server will be authoritative for item existence, instance identity,
definition, rarity, ownership, drops and equipped state. A client may request
an action and display returned data, but may never mint or modify authoritative
item state.

## Consequences

- Identity survives catalog reordering and display-text changes.
- An instance cannot disagree with its definition about its slot.
- Catalog errors are intentional `GameCoreError` codes, not undefined-property
  failures.
- Supporting historical items requires retaining compatible definitions and,
  once balance data exists, the applicable immutable content/rules version.
- The current model does not yet express ownership, inventory, equipment,
  drops, affixes, stats, unique-item constraints or content deprecation state.

## Alternatives Considered

**One model for definitions and owned items.** Rejected: it duplicates static
data, prevents multiple independent instances and creates divergent state.

**Rarity on the definition.** Rejected for the initial loot direction: it
would require `iron_sword_common`, `iron_sword_rare`, and so on. Instance rarity
supports rolled tiers while leaving room for later construction constraints.

**Array indexes as definition IDs.** Rejected: reordering content would change
identity and corrupt persisted references.

**Generate UUIDs inside Game Core.** Rejected: environment randomness is an
outer-boundary concern and would violate purity/determinism.

**Put the catalog into frozen `RULES_V1`.** Rejected: the catalog has no effect
on v1 combat or persisted simulations. Mutating `RULES_V1` would blur content
availability with historical simulation behavior. Versioned balance content is
deferred until it exists and can be designed from concrete requirements.

**Add empty affix/effect arrays now.** Rejected: untyped placeholders establish
no invariant and prematurely implement Phase 6.
