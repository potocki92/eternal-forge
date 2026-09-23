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
see "Stage selection and farming". FUTURE: auto-battle and offline
progression (Phase 4 PR 4.2+).

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
  mode and the client only chooses it.
- **Offline progression (Phase 4)** simulates from `currentStage` under the
  selected mode and applies the same transition, so the records only ever
  rise offline as well.
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

# Equipment slots

Initial target:

Weapon
Helmet
Chest
Gloves
Boots
Ring
Amulet

Future slots may be introduced through data/configuration.

---

# Item rarity

Initial rarity model:

Common
Magic
Rare
Epic
Legendary
Mythic

Future tiers may exist.

Rarity influences:

- affix count,
- affix quality,
- special effects,
- visual presentation.

---

# ItemDefinition vs ItemInstance

Important distinction.

ItemDefinition describes a type of item.

Example:

Demonfang Sword

ItemInstance represents a specific player's item.

Example:

Demonfang Sword
Level 483
+18% Crit Chance
+245% Crit Damage
+34% Attack Speed

Two instances of the same definition can be different.

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
