# ADR-026 — Deterministic item drops and exactly-once reward persistence

## Status

Proposed — 2026-09-24 (Phase 5, PR 5.3).

## Context

ADR-024 defined immutable catalog identities and ADR-025 made item ownership durable, but no legitimate gameplay action awarded an item. Adding loot is an economy rule: it must be reproducible without perturbing combat RNG, and the resulting instance must commit exactly once with the combat progression that earned it.

## Decision

1. **Eligibility.** Only an online combat whose authoritative outcome is `WIN` rolls loot. Losses, rejected/stale/unauthorized commands and failed transactions award nothing. Both `PROGRESS` and `FARM` wins are eligible. Bosses use the same rule as regular stages: no guarantee or modifier.
2. **Rules version.** `GAME_RULES_VERSION` advances from 1 to 2. `RULES_V1` is unchanged and retained for replay. `RULES_V2` copies its combat/progression/gold/XP/offline values exactly and adds the separately centralized v2 loot rules. Thus old combat fingerprints remain rules-v1 golden vectors; combat balance is identical under v2.
3. **Chance.** Every eligible victory has `1,000 / 10,000` (10%) chance. Probabilities are integer basis points.
4. **Loot table.** The seven catalog definitions are an explicit ordered v2 pool, selected uniformly with unbiased `nextInt(7)`. Slot weighting is therefore uniform. Issued IDs may never be removed or reused; old definitions remain resolvable.
5. **Rarity.** A cumulative 10,000-point table is explicit, not enum-order-derived: COMMON 7,000 (70%), MAGIC 2,000 (20%), RARE 700 (7%), EPIC 200 (2%), LEGENDARY 90 (0.9%), MYTHIC 10 (0.1%). Stage and boss status do not modify it.
6. **Independent RNG.** Loot derives `deriveSeed(combatSeed, "item-drop", rulesVersion, stageDecimal)`. The length-prefixed `deriveSeed` encoding is the stable derivation contract. Combat consumes only its original RNG. Loot draws are: (1) chance in `[0,10000)`; if it misses, stop; otherwise (2) definition in `[0,7)`, then (3) rarity in `[0,10000)`. Losses and rules v1 consume none.
7. **Pure resolution.** Game Core returns only `{ definitionId, rarity } | null`. It performs no I/O, UUID generation, clock access or mutation and validates selection against the catalog-owned pool.
8. **Persistent identity.** The trusted Prisma repository lets PostgreSQL's `gen_random_uuid()` create the `ItemInstanceId` inside the reward transaction. The browser supplies no loot field or seed. There is no mint endpoint. The API derives `nameKey` and `slot` from `ItemCatalog` and returns the persisted item in `combat.rewards.item`.
9. **Reward identity and constraint.** `item_instances.combat_run_id` is nullable and unique. A composite FK `(combat_run_id, character_id)` to `combat_runs(id, character_id)` records the authoritative reward identity, enforces matching ownership, and permits zero or one item per online combat. Definition plus rarity is deliberately not unique, so distinct victories can award equivalent instances.
10. **Transaction and rollback.** One Prisma transaction conditionally updates the owned character/version, creates the combat run, and creates the item. Any item failure rolls back progression, gold, XP, stage, version, combat row and item. A retry is then safe.
11. **Retry and concurrency.** `(character_id, idempotency_key)` remains the combat idempotency key. A committed retry loads its combat and awarded-item relation and returns the same instance ID. Concurrent replicas serialize through `characters.version` and the combat uniqueness constraint; the loser reloads the winner. The item FK uniqueness is database defence in depth.
12. **Trusted creation boundary.** ADR-025's standalone `createTrustedItem` remains for internal fixtures/future acquisition. Combat does not call it because it owns an independent transaction; the combat repository instead materializes generation data with the combat transaction.
13. **Auto Battle.** Auto Battle repeatedly calls the ordinary online combat command with one idempotency key per intent, so it uses exactly this pipeline. Retry/restart replays the combat and its same item.
14. **Offline Progression.** Offline item drops are explicitly deferred. Current offline claims aggregate up to 28,800 fights into one `offline_runs` row and promise combat-equivalent gold/XP, not item rewards. Adding potentially thousands of item rows requires a bounded acquisition/batch and response design; silently looping inserts in PR 5.3 is rejected. A regression test keeps offline inventory unchanged. `RULES_V2.offline` remains numerically identical to v1.
15. **API.** Online combat rewards add `item: ItemInstanceDto | null`; no request field changes. Inventory reads the same row immediately. Drops are never auto-equipped.
16. **Security.** Existing RLS/no-policy and revoked `anon`/`authenticated` privileges cover the new nullable column. The FK targets an API-owned RLS table. No browser role can create or associate rewards.
17. **Observability.** Existing `combat.replayed` identifies reward replay. The response and durable relation provide audit data. Per-draw logging and a new metrics platform are intentionally not introduced.
18. **Phase boundary.** Rarity remains classification only. No affix, stat, equipment effect, auto-equip or inventory UI is added; Phase 6 must version effective equipment snapshots when stats enter combat.

## Consequences

An online victory's item is all-or-nothing with progression and exactly once under retry and cross-instance concurrency. Historical v1 simulations remain reproducible. V2 has simple conservative balance that can be audited and later superseded, never edited after use. Offline loot remains a visible product decision rather than an accidental unbounded write path.

## Alternatives Considered

- Consuming more combat RNG was rejected because it changes attack transcripts.
- Calling `createTrustedItem` after commit was rejected because it permits partial rewards.
- Definition/rarity uniqueness was rejected because separate combats may legitimately award equivalent items.
- Deterministic UUIDs were rejected: persisted replay already preserves the original trusted UUID.
- Guaranteed bosses, stage scaling and weighted slots were rejected because no approved design specifies them.
- Per-offline-fight inserts were rejected as unbounded and incompatible with ADR-023's aggregate claim model.
