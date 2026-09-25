# Eternal Forge — Game Design Document

Status: EARLY DESIGN

This document defines gameplay intent.

Exact balance values are NOT final.

Do not treat example numbers as permanent balance unless explicitly marked.

---

# Player Character

The player controls one primary character.

There are no permanently locked traditional classes.

Character identity emerges from the build.

---

# Primary Stats

Initial planned stats:

Health
Damage
Attack Speed
Critical Chance
Critical Damage
Armor
Armor Penetration

Potential later stats:

Dodge
Block
Life Steal
Health Regeneration
Cooldown Reduction
Movement/Combat Speed
Elemental Damage
Elemental Resistance

---

# Damage types

Planned:

Physical
Fire
Cold
Lightning
Poison
Bleed
Void
Holy

Not all must exist in the initial implementation.

---

# Combat

Combat is primarily automatic.

The player's strategic decisions happen through:

- equipment,
- skills,
- passive tree,
- effects,
- companions,
- build configuration.

The Game Core determines combat outcome.

Visual combat represents that outcome.

## Combat rules v1 — IMPLEMENTED (Phase 1)

The first executable rules, in `packages/game-core` (`RULES_V1`). Mechanics are
listed here; the numbers are provisional balance and live only in the rule set.

- Both sides start at full health and attack automatically.
- Stats: Health, Damage, Attack Speed, Critical Chance, Critical Damage. Rates
  are integer basis points (10 000 = 100%, or one attack per second).
- A side's `k`-th attack lands at exactly `k / attacksPerSecond` seconds.
  Simultaneous attacks resolve player first.
- Each attack rolls once for a critical hit. A critical hit deals
  `damage × critDamage`.
- Attack speed and critical chance above their caps have no effect.
- Health never drops below zero. Combat ends when either side reaches zero.
- A combat still undecided at the time limit is lost. An enemy the player
  cannot kill in time is a progression wall.
- Armor, armor penetration, damage types and effects are PLANNED (Phase 6).

Stage and reward rules v1 — IMPLEMENTED (Phase 1):

- Every stage is an independent combat at full health.
- Enemy health and damage are `base × growth^(stage − 1) × archetype
  multiplier`, computed in one scaling module.
- Every 10th stage is a boss stage with a separate archetype. Bosses have more
  health and damage but, in v1, no mechanics beyond numbers.
- Clearing a stage yields gold and experience,
  `floor(base × growth^(stage − 1))`, multiplied for bosses. A loss yields
  nothing.
- A character's health and damage grow per level. Level-ups from experience
  are IMPLEMENTED in Phase 3 (below).

## Progression rules v1 — IMPLEMENTED (Phase 3)

The first persistent loop (ADR-019). The numbers are provisional balance and
live only in `RULES_V1.progression`. Rules v1 was extended in place because
nothing produced under it had been persisted yet. `RULES_V1` is immutable once
PR #6 is merged. Any later change to balance or to the stage transition needs
rules v2 (ADR-020 §8).

- **One stage at a time.** The player fights the enemy on the character's
  current stage. The server chooses the stage, the enemy and the seed. The
  player only decides *when* to fight.
- **Win:** the stage's gold and experience are granted, the stage counts as
  cleared, and the character advances exactly one stage.
- **Loss:** nothing is granted, and the character falls back one stage
  (`stagesLostOnDefeat`), never below stage 1. A wall becomes a farm: the
  player earns rewards on the stage before it until their level beats it.
  Without this rule the only progression source would dry up at the first
  wall. A simulation of the loop stalled permanently at the stage-10 boss.
  The rule is **uniform**: a defeat on a regular stage falls back just like a
  boss defeat. "Retry the same stage" would deadlock a hero that loses a
  regular stage, because Phase 3 offers no other progression source and no
  stage choice. Under `RULES_V1`, regular-stage losses do not occur in
  simulated play (0 of 1 421 losses), so the uniform rule costs nothing. It
  is rule data, and `0` means retry (ADR-020 §3).
- **Records are separate from position (ADR-020).** A character has a
  *current stage* (where it fights next), a *highest stage reached* (the
  furthest stage unlocked) and a *highest stage cleared* (the furthest stage
  defeated, none before the first victory). The two records never decrease. A
  boss defeat on stage 10 therefore leaves the hero on stage 9 with stage 10
  reached and stage 9 cleared: `9 / 10 / 9`. The game screen shows the current
  stage and, compactly, the best stage cleared.
- **Levels:** going from level `L` to `L + 1` costs
  `floor(10 × 1.10^(L − 1))` experience. Experience is kept as progress
  within the current level. One reward can grant several levels, at most
  1 000 per reward, and any remainder is kept. The level cap is 2^31 − 1, the
  column's range.
- **Pacing:** a combat occupies the hero for its simulated duration. The next
  fight unlocks on the server's clock when that time has passed, and the
  client's animation lasts exactly as long. Time is the resource of an idle
  game, so it cannot be skipped by sending requests faster. The animation
  itself can be skipped; the wait cannot.
- **Bosses:** every 10th stage, as the rule set classifies it. Bosses are
  bigger numbers with a separate archetype and a distinct presentation. Boss
  *mechanics* remain PLANNED.

Measured with the real Game Core over simulated play (seeded): stage 10 is
reached after about 1 minute of combat time. The first boss takes about 8
minutes of farming, stage 50 about 48 minutes and stage 100 about 4 hours.
Walls at each boss are intended. Builds (Phases 5–8) are meant to break them.

IMPLEMENTED (Phase 4 PR 4.1): a player-controlled "stay and farm" choice —
see "Stage selection and farming". IMPLEMENTED (Phase 4 PR 4.2): online
auto-battle — see "Online auto-battle". IMPLEMENTED (Phase 4 PR 4.3):
offline progression — see "Offline progression rules v1".

## Stage selection and farming — IMPLEMENTED (Phase 4 PR 4.1, ADR-021)

- **Two modes.** *Continue climbing* (`PROGRESS`) is the Phase 3 behaviour:
  a win moves on, a loss falls back one stage. *Stay on this stage* (`FARM`)
  keeps the hero on the chosen stage after a win **and** after a loss.
- **Choosing a stage.** Farming may use any stage from 1 to
  `highestStageReached`, including the frontier itself (to retry a boss).
  A higher stage is refused (`STAGE_LOCKED`). "Continue climbing" always
  resumes from `highestStageReached`; the player sends no stage.
- **Same fight, same pay.** A farm combat uses the same enemy, combat,
  rewards and experience as climbing. Only the next position differs.
- **Records.** A win clears the stage fought and unlocks the next, in either
  mode; a loss changes no record. Farming stage 99 below an unbeaten stage-100
  boss keeps `99 / 100 / 99` however often it is won. Winning a reached but
  uncleared stage while farming it is a real clear and is recorded as one.
- **Persistence.** The mode and stage are server state: they survive a
  refresh, a new session, an API restart and another device.

## Online auto-battle — IMPLEMENTED (Phase 4 PR 4.2, ADR-022)

- **What it is.** The player presses *Auto battle*; while the game is open and
  visible, the hero fights one combat after another, in the selected mode.
  *Stop auto battle* ends it after the fight in progress.
- **Same fights, same pace.** Every auto fight is an ordinary combat: same
  enemy, rules, rewards and stage transition, and the same pacing gate (a
  combat occupies the hero for its duration). Auto-battle only saves the
  taps; it never earns more per minute than tapping Fight at the right time.
- **Modes.** Climbing on auto moves on after each win and falls back after a
  loss, exactly as by hand. Farming on auto stays on the farm stage whatever
  happens; the first win on an uncleared frontier stage is a real clear
  (ADR-021). A mode or stage change while auto-battle runs applies to the next
  fight.
- **Online only.** It pauses while the game is hidden and stops on reload,
  sign-out or a lasting error, and nothing is earned for time the game was
  not in front of the player. Progress while away is offline progression
  (PR 4.3), a separate, capped server calculation.

Still FUTURE:

- **FARM (original sketch).** The player picks any stage from 1 to
  `highestStageReached` as the current stage. Rewards are those of the chosen
  stage. The records do not move until the player wins beyond them —
  implemented as described above.
- **CHALLENGE BOSS.** Farming stops below a boss. A single action moves the
  hero to the boss stage it has reached. On defeat it returns to the farm
  stage the player chose, instead of the default fallback.
- **Auto modes.** *Push*, the Phase 3 behaviour: advance on a win, fall back
  on a loss. *Farm*: stay on the chosen stage. *Push then farm*: push until
  the first loss, then farm one stage below the wall. The server executes the
  mode and the client only chooses it. (Online auto-battle, PR 4.2, runs the
  two existing modes; *push then farm* is still FUTURE.)
- **Offline progression (Phase 4)** — superseded by ADR-023: offline
  progression farms only an already-cleared stage and never moves a stage or
  a record (see "Offline progression rules v1").
- **Rankings (Phase 10).** The Highest Stage ranking uses
  `highestStageCleared`. It is proven by a recorded win and cannot be lowered
  by farming, and a player with no clear is unranked.

---

# Stage progression

Stages are effectively unlimited.

Conceptually:

1
10
100
1,000
10,000
100,000
...

Do not design database schemas around a fixed maximum stage.

IMPLEMENTED (ADR-018): a stage number is an exact integer from 1 to 2^63 − 1,
the PostgreSQL `bigint` range. It is never a floating-point value. In practice
the rule set is the limit: under rules v1, enemy scaling overflows `HugeNumber`
around stage 4·10^10, and that is reported as an error rather than a wrong
value. A combat requested there is refused with `409 STAGE_NOT_PLAYABLE`, and
nothing is written (ADR-020 §7).

Regular enemies occupy normal stages.

Boss encounters appear at defined intervals.

---

# Enemy scaling

Enemy scaling must be centralized.

Do not scatter scaling formulas throughout the project.

Expected inputs may include:

stage
enemy archetype
world
difficulty modifiers
season modifiers

Expected outputs:

health
damage
defense
rewards
special modifiers

Balance formulas will evolve.

---

# Bosses

Bosses should eventually introduce mechanics rather than merely more HP.

Potential mechanics:

shield
regeneration
critical resistance
damage reflection
summoning
elemental resistance
multiple phases
enrage
time limit

Build adaptation should matter.

---

# Equipment slots — FOUNDATION IMPLEMENTED (Phase 5 PR 5.1, ADR-024)

Initial target:

Weapon
Helmet
Chest
Gloves
Boots
Ring
Amulet

The canonical domain/wire values are `WEAPON`, `HELMET`, `CHEST`, `GLOVES`,
`BOOTS`, `RING` and `AMULET`. A definition owns its slot; an instance does not
duplicate it. Future slots may be introduced through data/configuration.

---

# Item rarity — FOUNDATION IMPLEMENTED (Phase 5 PR 5.1, ADR-024)

Initial rarity model:

Common
Magic
Rare
Epic
Legendary
Mythic

The canonical domain/wire values are `COMMON`, `MAGIC`, `RARE`, `EPIC`,
`LEGENDARY` and `MYTHIC`, with one explicit rank table in that order. Rarity
is instance source state, so two instances of one definition may have different
rarities. It has classification and ordering meaning in PR 5.1 only. Future
tiers may exist through a deliberate compatibility decision.

In future phases, rarity may influence:

- affix count,
- affix quality,
- special effects,
- visual presentation.

---

# ItemDefinition vs ItemInstance

Important distinction, implemented in the pure Game Core foundation.

`ItemDefinition` describes a type of item: a stable definition ID, a stable
localization/content name key and one equipment slot. IDs are lowercase
human-reviewable keys and are never derived from catalog order.

Example:

Demonfang Sword

`ItemInstance` represents a specific player's item. It contains a canonical
UUID supplied by the server boundary, its definition ID and its rarity. It
does not contain a display name, slot, stats, level, ownership or persistence
state. Those concerns are derived or belong to later phases.

Example:

Demonfang Sword
Level 483
+18% Crit Chance
+245% Crit Damage
+34% Attack Speed

Two instances of the same definition can be different, including having
different rarity. PR 5.1 deliberately adds no affixes, stats, item power,
inventory, equipment state, drops, persistence, API or UI.

---

# Affixes

Affixes create build diversity.

Examples:

+Damage
+Attack Speed
+Critical Chance
+Critical Damage
+Fire Damage
+Poison Damage
+Bleed Chance
+Life Steal

Affixes must be data-driven.

---

# Effects

A generalized effect system should eventually support concepts such as:

ADD
MULTIPLY
OVERRIDE
TRIGGER
CONVERT

Examples:

+10% Critical Chance

+50% Fire Damage

ON_CRITICAL_HIT:
APPLY_BLEED

CONVERT:
20% PHYSICAL -> FIRE

Exact effect architecture belongs in ARCHITECTURE.md.

---

# Skills

Initial candidate active skills:

Whirlwind
Fireball
Execute
Blood Strike
Lightning Chain
Shield

Skills should support modifiers.

Example:

Whirlwind

+
Bleed modifier

+
Vacuum modifier

+
Critical modifier

produces a substantially different ability.

---

# Passive Tree

The Passive Tree should eventually contain hundreds or thousands of nodes.

Initial implementation target:

approximately 100 nodes.

Node categories:

small stat nodes
major nodes
keystones
build-changing nodes

Players must not be able to acquire everything.

Choices matter.

---

# Runes

FUTURE.

Equipment may contain sockets.

Example rune families:

Fire
Lightning
Blood
Poison
Frost
Void
Holy

Rune combinations may unlock synergy effects.

---

# Offline Progression

The game continues conceptually while the player is offline.

Do NOT continuously simulate every player.

Use server-authoritative elapsed time.

Inputs:

previous state
lastProcessedAt
current server time
build
game rules

Output:

calculated progression.

An offline progression limit will exist.

## Offline progression rules v1 — IMPLEMENTED (Phase 4 PR 4.3, ADR-023)

Numbers are provisional balance in `RULES_V1.offline`; the owner may adjust
them (a change needs rules v2).

- **When.** On returning to the game the client asks the server what the
  absence earned. The server measures it on its own clock from the moment
  the hero stopped fighting (`nextCombatAt`). Nothing runs while the player
  is away, and the device clock never matters.
- **How much.** At most **8 hours** count per claim; an absence beyond that
  is capped and the excess is lost. Under **1 minute** nothing is collected
  yet — the time keeps accumulating.
- **Where.** The hero farms the last stage it has proven: its current stage
  if cleared, else its highest cleared stage — `min(current, highestCleared)`.
  An intentional farm stage is respected; a hero standing on its unbeaten
  boss farms the stage below it. A hero with no cleared stage collects
  nothing. **Offline progression never fights an uncleared stage**: it never
  defeats or skips a boss, never unlocks a stage and never changes the
  current stage, the mode or a record. Breaking a barrier is the player's
  job, online.
- **The same game.** Fights follow each other back to back, each lasting its
  simulated duration (the online pacing rule). Each is an ordinary combat
  with the hero's stats at that moment: wins pay the stage's ordinary
  rewards and experience, level-ups make later fights stronger, losses pay
  nothing. There is no gold-per-hour formula and no offline multiplier.
- **Online and offline share one time line.** Online fights use up time as
  they happen; offline progress covers only the idle time after the last
  fight. Playing online and then leaving never pays the online time twice.
  An online fight started before claiming ends the idle period (the game
  client always claims first).
- **After a claim** the hero can fight online immediately.
- **Return presentation (Phase 4 PR 4.4).** A claim that fought is presented
  as a Welcome Back reward summary before combat resumes. It displays only
  the server's result, remains memory-only, and cannot award or recalculate
  anything. Zero-fight claims are silent; reaching the cap is framed as a
  successfully collected maximum rather than an error.

Measured under `RULES_V1` (seeded): a level-10 hero on stage 9 fights about
3 400 times per hour; 8 hours hold at most 28 800 fights.

---

# Prestige

Prestige is layered.

Planned progression:

Rebirth
↓
Ascension
↓
Transcendence
↓
Apotheosis

Prestige should eventually unlock mechanics rather than only provide numeric
multipliers.

---

# Rebirth

First prestige layer.

Possible reset:

stage
character level
temporary progression

Possible retained systems:

account unlocks
specific permanent upgrades

Reward:

Souls.

Exact reset rules will be defined during implementation.

---

# Eternal Levels

FUTURE.

Late progression may use an uncapped or practically uncapped Eternal Level
system.

It must not rely on a fixed small integer assumption.

---

# Tower of Eternity

Separate endless challenge.

Each run/floor becomes harder.

The player receives temporary roguelite-style choices.

Examples:

+Critical Damage
+Poison
+Projectile
-Cooldown

Ranking:

Highest Tower Floor.

---

# World Boss

Server-wide event.

Players contribute damage against a shared boss.

Track:

individual contribution
guild contribution
boss state
event duration

Rewards must be server-authoritative.

---

# Guilds

Planned:

guild creation
members
roles
guild progression
guild leaderboard
guild boss

Later:

guild fortress
guild technologies
guild events

---

# Arena

PvP is primarily asynchronous.

Players configure their build.

The server creates/saves an appropriate defensive snapshot.

Combat is deterministic where practical.

Potential ranking:

rating-based ladder.

---

# Seasons

Season duration is not yet final.

Seasons may introduce:

new mechanics
modifiers
items
bosses
leaderboards
challenges

The permanent character/account must not accidentally be destroyed by season
reset logic.

---

# Companions

FUTURE.

Examples:

Wolf
Dragon
Golem
Demon
Phoenix
Spirit

Companions may possess:

level
skills
equipment
evolution paths.

---

# Eternal Forge

Advanced crafting system.

Planned actions:

craft
upgrade
reroll
socket
rune
corrupt
awaken
ascend

Crafting results must be server-authoritative.

---

# Achievements

Achievements should eventually influence gameplay.

Examples:

kill milestones
boss achievements
death achievements
challenge achievements

Rewards may include:

titles
passive branches
mechanics
cosmetics
build options

---

# Rankings

Planned rankings include:

Highest Stage
Tower
Arena
Boss Damage
Season
Guild

Avoid reducing the entire game to one universal Power score.

---

# Design rule

Different systems should create different optimal builds.

The best boss build should not automatically be the best:

PvP build,
Tower build,
speed build,
survival build.

Build diversity is a core product requirement.

## Inventory and equipment persistence — COMPLETE / APPROVED (Phase 5 PR 5.2)

Inventory means all item instances owned by the character, including equipped items. Equipment is a seven-slot mapping; equipping replaces the prior item atomically and unequipping leaves ownership unchanged. Empty unequip and repeated equip are successful no-ops. Items have no stats or combat effect until Phase 6.

## Item drops — IN PROGRESS (Phase 5 PR 5.3, ADR-026)

Every eligible online victory, in either PROGRESS or FARM mode, has a rules-v2 10% item chance. The seven initial catalog definitions are selected uniformly. Rarity is COMMON 70%, MAGIC 20%, RARE 7%, EPIC 2%, LEGENDARY 0.9%, and MYTHIC 0.1%. Bosses and stage depth have no modifier. Losses never drop items. Drops enter inventory unequipped and still have no combat effect. Offline item drops are deliberately deferred pending a bounded aggregate reward design.

## Player gear experience — IN PROGRESS (Phase 5 PR 5.4)

Players can inspect the seven equipment slots and an inventory derived as all
owned items minus equipped instance IDs. Equip replaces the slot in one server
operation; Unequip returns the instance to the derived inventory. Cards show
only canonical name, rarity and slot. No statistics or affixes are implied.

## Character stats and modifiers — IN PROGRESS (Phase 6 PR 6.1, ADR-027)

The canonical initial character stats are Max Health, Damage, Attack Speed,
Critical Chance and Critical Damage because those are the values the current
combat engine already consumes. Max Health and Damage use `HugeNumber`;
Attack Speed, Critical Chance and Critical Damage use integer basis points.
Armor and effect mechanics are deliberately absent until their gameplay rules
exist.

Level and the selected immutable Game Rules derive base stats. One shared
modifier pipeline then applies all flat contributions, one additive percentage
pool, and domain clamps. Integer divisions round half to even. Modifiers carry
a stable source type and source ID so later UI can explain a result, but source
categories never change the mathematics.

Legal resolved values are Max Health >= 1, Damage >= 0, Attack Speed >= one
basis-point unit, Critical Chance from 0% through 100%, and Critical Damage >=
100%. Combat may additionally apply its rules-version attack-speed cap. No
stats are persisted: authoritative progression plus future modifier source
state is resolved on demand.

This PR does not make items stronger and does not alter combat. Item power and
affix generation are deferred to PR 6.2, equipment-to-combat integration to PR
6.3, and the player-facing stat/breakdown UI to PR 6.4.

## Item affixes (Phase 6 PR 6.2 — IN PROGRESS)

New items use item-generation V1. COMMON has 0 affixes; MAGIC 1; RARE 2; EPIC 3; LEGENDARY 4; MYTHIC 5. Rarity primarily adds breadth rather than stronger ranges. Initial affixes cover only Max Health, Damage, Attack Speed, Critical Chance and Critical Damage, with slot-specific data-driven eligibility. Every roll is immutable and displayed in stable order. Item definitions have no intrinsic power in this first pass, so COMMON is an intentional zero-modifier baseline. Existing Phase 5 items are legacy V0 with zero affixes. Equipment still has no combat effect until PR 6.3.
