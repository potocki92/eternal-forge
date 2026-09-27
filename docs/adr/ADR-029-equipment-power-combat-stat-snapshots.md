# ADR-029 — Equipment power and combat stat snapshots

## Status

Proposed — 2026-09-27 (Phase 6, PR 6.3).

## Context

ADR-027 defined canonical character stats and ADR-028 persisted immutable item rolls. Combat previously derived player power only from level, and replay re-derived it from the recorded level. Once equipment affects a fight, current equipment cannot be consulted during replay and a concurrent equipment mutation must not produce mixed state.

## Decision

1. **Authoritative boundary.** The combat repository owner-scoped read loads the character version and all equipped `ItemInstance` rows with their persisted affix rolls in one query. Inventory is not an input and the request accepts no stat, item, affix, or seed value.
2. **Resolution.** Game Core derives level base stats, maps each persisted roll through `getItemStatModifiers`, resolves the one ADR-027 modifier multiset, then uses the single `toCombatStats` adapter. Duplicate instance identities are rejected. Equipment order is irrelevant. Legacy V0 and Common V1 items have no rolls and add no power.
3. **Adapter semantics.** HugeNumber health and damage are passed without numeric conversion. Integer attack speed is attacks-per-second basis points (`10000 = 1/s`); combat applies its versioned `100000` cap. Critical chance is integer basis points clamped to `0..10000`. Critical damage is the total multiplier (`15000 = 150%`), not bonus damage. Character resolution performs half-even rounding and minima before this naming-only adapter.
4. **Snapshot.** Every V3 online `CombatRun` stores max health and damage as canonical HugeNumber coefficient/exponent pairs, plus attack speed, critical chance, and critical damage as integers. Columns are nullable only as one complete group for truthful historical V1/V2 rows; V3 rows require the group. Whole ItemInstances and catalog metadata are not copied.
5. **Replay and retry.** V3 replay supplies the stored snapshot to Game Core and never reads current gear. A retry after replacement therefore returns the original result, snapshot, and reward. V1/V2 rows retain their old level-only derivation and old goldens.
6. **Versioning.** `GAME_RULES_VERSION` advances 2 → 3. `RULES_V1` and `RULES_V2` remain unchanged; `RULES_V3` composes V2 balance. Item generation remains V1 and affix catalog/ranges and rarity budgets are unchanged.
7. **Concurrency.** Equipment and combat both condition writes on `character.version`. The combat read contains character and equipment together; if equip commits after that read, combat's conditional write loses and commits nothing. If combat commits first, it uses the complete pre-equip set. No process lock is used.
8. **Modes.** PROGRESS and FARM share the ordinary combat command. Online Auto Battle is repeated ordinary commands, so new gear applies to the next not-yet-committed battle. Already committed battles never change.
9. **Offline progression.** Equipment power is deferred for offline claims. ADR-023 aggregates many fights into one run and persists no per-fight combat snapshots; claim-time equipment would need an explicit aggregate snapshot/replay migration. V3 offline therefore intentionally retains the level-only model rather than creating an approximation. This limitation is visible until separately designed.
10. **Security and UI.** Only server-loaded equipment can affect combat. RLS and revoked browser privileges remain unchanged. Routine logs do not include modifiers. Phase 6.4 may expose explanatory final stats but no presentation work is included here.

## Consequences

Equipping stronger persisted rolls changes the next coherently committed online combat, while database ordering, current inventory, later catalog balance, equipment replacement, and retry timing cannot rewrite history. Seven eager-loaded slots avoid N+1 reads. Snapshot columns and a migration are required.

## Alternatives considered

Persisting item IDs was rejected because ownership/catalog changes would alter replay. Re-reading current equipment on replay was rejected because it rewrites history. JSON snapshots were rejected because five fixed typed values have stronger lossless constraints. Enabling offline gear without an aggregate replay design was rejected. Keeping rules V2 was rejected because production combat outcomes now change.
