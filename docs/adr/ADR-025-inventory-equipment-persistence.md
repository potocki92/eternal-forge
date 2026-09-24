# ADR-025 — Inventory and equipment persistence

## Status

Proposed — 2026-09-24 (Phase 5, PR 5.2).

## Context

ADR-024 separates static definitions from generated instances. PR 5.2 must persist ownership and equipment without allowing a browser to mint items, claim ownership, choose an equip slot, or race combat/offline writes into inconsistent state.

## Decision

1. **Ownership and inventory.** An item belongs directly to one character. `item_instances.character_id` is the inventory: no array or container row exists. The API's `ownedItems` contains all owned items, including equipped items; unequipped inventory is derived by subtracting equipment IDs. Results order by `created_at`, then ID. It is intentionally unpaginated for Phase 5; cursor pagination on that tuple is the scaling path.
2. **Source state.** An instance row stores UUID, character, canonical definition ID, canonical rarity, and creation time. Name key and slot remain catalog-derived; static definition data is not duplicated. Canonical rarity and slots use constrained text rather than PostgreSQL enums, making additive catalog evolution an explicit constraint migration without enum-order semantics.
3. **Equipment.** `character_equipment(character_id, slot, item_instance_id)` is normalized. Its primary key enforces one item per character/slot; a unique item ID prevents one instance occupying two slots. A composite FK `(item_instance_id, character_id)` to the owned item enforces same-character ownership even if application checks fail. Seven canonical slot values are CHECK-constrained.
4. **Catalog compatibility.** Every repository read parses the instance through `ITEM_CATALOG` and fails loudly for malformed/unknown persisted definitions or rarities. Trusted creation also requires catalog resolution. Issued definition IDs may never be removed or reused while rows reference them.
5. **Commands.** Equip accepts only an opaque item instance ID, proves character and item ownership under the authenticated subject, resolves its definition, derives the slot, and atomically replaces that slot. The displaced item remains owned. Equipping the already-equipped instance succeeds without a write. Unequip accepts a canonical slot, deletes only that slot row, and an empty slot is a successful no-op.
6. **Transactions and concurrency.** A real change conditionally increments `characters.version`, scoped by owner, ID, and expected version, then changes equipment in the same PostgreSQL transaction. This serializes equipment with combat, stage selection, and offline claim across API processes. A stale attempt rolls back/retries up to three times. Database keys remain the final invariant. Reads after commit return authoritative equipment and version.
7. **Version meaning.** Equip/unequip increment `character.version` because equipment is authoritative mutable character state and future Phase 6 combat snapshots must not commit across a concurrent gear change. Retry no-ops do not increment it.
8. **Privileges.** Both tables have RLS enabled with no browser policies, and `anon`/`authenticated` privileges are revoked. The privileged NestJS API is the only mutation surface; service credentials remain server-only.
9. **Deletion.** Character deletion cascades its equipment and owned instances, matching existing character deletion. Trusted deletion of an item cascades its equipment row, so it cannot leave a dangling reference; no player-facing deletion exists.
10. **Trusted creation.** The repository exposes `createTrustedItem` for server-owned future acquisition and test fixtures only. There is no HTTP mint endpoint. PR 5.3 may call this from its server-authoritative drop transaction.
11. **Combat and future effects.** Equipment has zero stat effect in PR 5.2. `GAME_RULES_VERSION` and combat fingerprints do not change. Phase 6 must snapshot/version effective equipment inputs when effects enter deterministic simulation.
12. **Deployment.** The additive migration must be deployed before the new API. **AFTER MERGE: RUN “Deploy Supabase DEV” BEFORE VALIDATING THE NEW ITEM API AGAINST DEV.**

## Consequences

PostgreSQL rejects cross-owner equipment, duplicate slots, duplicate item placement, invalid canonical slot/rarity values, and orphaning an equipped item. Replacement is one atomic operation and retries are naturally safe. Catalog definitions remain an operational compatibility commitment. Inventory initially returns the complete collection.

## Alternatives Considered

- A nullable slot on item instances was rejected because it mixes ownership with equipment and weakens the explicit character/slot uniqueness model.
- Seven columns on characters were rejected as denormalized and migration-heavy for future slots.
- A JSON inventory was rejected because it loses relational ownership and constraints.
- A separate idempotency table was rejected: state-setting commands are stable no-ops on retry and grant no reward.
- Account ownership was rejected because current progression and equipment are character state.
