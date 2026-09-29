# ADR-030 — Server-authoritative character stats and equipment preview queries

## Status

Proposed — 2026-09-29 (Phase 6, PR 6.4).

## Date

2026-09-29

## Context

Since ADR-029, equipped items change the stats of the next online combat.
The player could see an item's affix text (`+18 Damage`, `+7.00% Critical
Damage`) but not what it does: flat terms and one additive percentage pool
interact (ADR-027), rounding is half-to-even, Critical Chance is clamped at
100% and combat caps Attack Speed. An affix can therefore change a stat by
less than its text suggests, or not at all.

Answering "what are my stats?" and "what would this item change?" requires the
exact resolver. Reimplementing it in the browser would create a second stat
pipeline that can drift from combat — and the web application may not use
Game Core to compute gameplay values (ADR-003, ADR-013). Two decisions follow:
where the numbers come from, and which numbers the player sees.

## Decision

1. **Two read-only queries, no new command.**
   - `GET /player/characters/:characterId/stats` returns the character's
     current stats.
   - `GET /player/characters/:characterId/stats/preview?equip=<itemInstanceId>`
     or `?unequip=<SLOT>` returns the current stats, the stats after that one
     change, and the delta.

   They are `GET` because they are safe and idempotent queries. The query is a
   strict shared Zod union: exactly one intent, mirroring what the equip and
   unequip commands accept. No slot for an equip, rarity, affix, stat, seed or
   version override can be sent; any extra parameter is a 400.

2. **One pipeline.** Game Core owns `resolvePlayerCombatStats(level,
   equippedItems, rules)` — level base → equipped modifiers → the ADR-029
   adapter. The combat use case now calls it for its snapshot and the stats
   query calls it for the sheet, both under `GAME_RULES_VERSION`. Game Core's
   `describeCharacterStats` and `previewEquipmentChange` build on it. The
   browser computes no stat, delta or cap.

3. **Displayed stats are combat-effective.** `effective` is the resolved
   combat input after the rule set's combat caps (`applyCombatCaps`) — the
   values the combat engine fights with. Below every cap it is byte-identical
   to the `CombatRun` player snapshot, which an integration test proves for a
   stable loadout. Above the attack-speed cap the snapshot keeps the resolved
   input (ADR-029) while the sheet shows the capped value that actually
   applies. `atMaximum` names the stats sitting at a hard maximum. Raw,
   uncapped values are not exposed: no current screen needs them and they
   would mislead.

4. **Breakdown semantics.** Each sheet has `base` (level only), `effective`
   and `bonus = effective − base`, computed with HugeNumber on the server.
   Equipment is today the only modifier source, so `bonus` is exactly the net
   effect of the equipped items after pooling, rounding, minima and caps — not
   a sum of affix text. The equipped rolls that fed the resolver are returned
   as `sources` (stat, operation, value, slot, item definition, name key,
   rarity) without instance or roll UUIDs. They are inputs, not per-item
   contributions, because a percentage roll's contribution depends on every
   other roll.

5. **Preview semantics.** The candidate must be owned by the character; a
   foreign or missing item is `404 NOT_FOUND`, indistinguishable. The slot is
   derived from the catalog, and the change is applied to an in-memory copy of
   the loadout: the candidate *replaces* the item in its slot, so the two
   never stack. An already-worn candidate or an already-empty slot answers
   `unchanged: true` with a zero delta. Both loadouts are resolved by the same
   function, so caps and rounding apply exactly as in combat; a candidate that
   adds Critical Chance to a hero at 100% shows no change.

6. **Read-only by construction, coherent by snapshot.** The repository port
   has a single read method. Its adapter loads the level, the version, the
   equipped instances with ordered rolls and at most one candidate — never the
   rest of the inventory — inside one `REPEATABLE READ` transaction. Prisma
   reads relations with separate `SELECT`s; without the snapshot a concurrent
   equip could pair the old version with the new equipment, a state that never
   existed (found by the integration race test). Nothing is persisted: no
   table, cache or column. The response carries `characterVersion`, the
   version of exactly the loadout it describes.

7. **Client caching.** TanStack Query keys nest under
   `['player', userId, 'character', characterId]`; a preview is also keyed by
   the equipment's `characterVersion` and the intent. Equip and unequip use
   one rule, `invalidateGearState`: write the authoritative equipment, then
   refetch inventory, stats and previews. Combats and offline claims mark
   the gear state stale (every write moves the version) and refetch stats only
   after a level-up. The combat screen's idle hero health reads the same
   stats query, because `progression.hero` remains level-only.

8. **No gameplay change.** `GAME_RULES_VERSION` stays 3, combat output, item
   drops, item generation V1 and affix balance are unchanged, and there is no
   migration. Offline claims remain level-only (ADR-029 §9); the sheet shows
   online combat power and makes no offline claim.

## Consequences

- The character sheet, the comparison and the next online combat cannot
  disagree for an unchanged loadout: they are one function over one coherent
  read. A preview for an unchanged loadout equals the stats after the equip,
  which an integration test also proves.
- Every preview is a server round trip (one indexed, owner-scoped read of at
  most eight instances). It is cached per version, so reopening an item is
  instant and a change elsewhere cannot surface an old comparison.
- The idle combat screen issues one extra `GET` on mount and after each
  level-up.
- A future modifier source (skills, passives, buffs) must decide whether it
  belongs in `bonus`, which today means "from equipment", and extend the
  sheet deliberately.
- A future stat where smaller is better must set its own presentation
  direction; the web maps "more is better" explicitly per current stat.

## Alternatives considered

- **Resolve stats in the browser from the equipment it already has.**
  Rejected: a second pipeline that drifts from combat, and it would require
  shipping the resolver to the client against ADR-003.
- **Show resolved stats before combat caps.** Rejected: they can show power
  that combat ignores.
- **Show `effective − base` computed in the browser.** Rejected: the web may
  only parse and format HugeNumbers, and the server already has exact values.
- **A `POST` preview endpoint.** Rejected: a preview writes nothing; `GET`
  with a strict query states that and is safe to retry.
- **Include stats in the equip/unequip responses.** Rejected for now: it
  changes an existing contract to save one refetch, and the stats query is
  needed independently.
- **Persist previews or computed stats.** Rejected: derived values that go
  stale, and ADR-027 persists source state only.
- **A DPS, power score or item level.** Rejected: combat is a timeline with
  caps and deterministic criticals; a single score would misstate it until a
  balance design defines one.
