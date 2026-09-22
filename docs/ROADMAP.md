# Eternal Forge — Development Roadmap

Last updated: 2026-09-22

# Current Phase

PHASE 0 — FOUNDATION

Status:

NOT STARTED

Claude must NOT begin another phase without explicit user approval.

---

# Phase 0 — Foundation

Status: NOT STARTED

Goal:

Create a production-quality project foundation.

Tasks:

- [ ] initialize pnpm workspace
- [ ] configure Turborepo
- [ ] create apps/web
- [ ] create apps/api
- [ ] create apps/worker
- [ ] create packages/game-core
- [ ] create packages/contracts
- [ ] create packages/database
- [ ] create packages/ui
- [ ] create shared configuration
- [ ] configure strict TypeScript
- [ ] configure ESLint
- [ ] configure formatting
- [ ] configure environment validation
- [ ] prepare PostgreSQL integration
- [ ] prepare Redis integration
- [ ] prepare Supabase integration
- [ ] add API health endpoint
- [ ] add web health/start page
- [ ] add worker smoke mechanism
- [ ] configure Vitest
- [ ] configure Playwright skeleton
- [ ] configure GitHub Actions
- [ ] create ADRs
- [ ] validate lint
- [ ] validate typecheck
- [ ] validate tests
- [ ] validate build
- [ ] deploy initial web application to Vercel

Do NOT implement gameplay.

Completion requires user approval.

---

# Phase 1 — Game Core Foundation

Status: NOT STARTED

Goal:

Create the first deterministic headless game simulation.

Implement:

- HugeNumber
- deterministic RNG
- Character
- Enemy
- Stats
- Damage
- Attack Speed
- Critical Chance
- Critical Damage
- CombatResult
- Stage
- Stage Scaling
- basic Rewards
- simulateCombat
- simulateStages

Target:

A CLI/test simulation can produce:

Stage 1 WIN
Stage 2 WIN
...
Stage N LOSS

No combat UI yet.

---

# Phase 2 — Authentication & Player

Status: NOT STARTED

Implement:

- Supabase Auth
- registration
- login
- logout
- profile
- character
- authenticated backend
- persistence
- GET /player/state
- authorization tests

---

# Phase 3 — First Gameplay Loop

Status: NOT STARTED

Implement:

Combat
-> enemy defeated
-> reward
-> next stage
-> boss
-> progression.

Create first mobile-first game screen.

Introduce PixiJS CombatScene.

Game Core remains authoritative.

---

# Phase 4 — Offline Progression

Status: NOT STARTED

Implement:

- lastProcessedAt
- server-authoritative time
- elapsed progress
- offline cap
- offline rewards
- claim
- idempotency
- offline summary UI
- edge case tests

---

# Phase 5 — Items & Equipment

Status: NOT STARTED

Implement slots:

Weapon
Helmet
Chest
Gloves
Boots
Ring
Amulet

Implement rarity:

Common
Magic
Rare
Epic
Legendary
Mythic

Implement:

ItemDefinition
ItemInstance
Inventory
Equip
Unequip
Drops
Persistence

---

# Phase 6 — Affixes & Effects

Status: NOT STARTED

Implement generalized modifier/effect system.

Initial mechanics:

Damage
Attack Speed
Crit Chance
Crit Damage
Bleed
Poison
Fire Damage

Content must remain data-driven.

---

# Phase 7 — Active Skills

Status: NOT STARTED

Initial candidate skills:

Whirlwind
Fireball
Execute
Blood Strike
Lightning Chain
Shield

Implement skill levels and cooldown architecture.

---

# Phase 8 — Passive Tree

Status: NOT STARTED

Initial content:

approximately 100 nodes.

Architecture must support significantly more.

Implement:

prerequisites
branches
cost
allocation
respec
validation.

---

# Phase 9 — Rebirth

Status: NOT STARTED

First prestige layer.

Implement:

reset rules
Souls
persistent upgrades
transaction safety
idempotency.

---

# Phase 10 — Leaderboards

Status: NOT STARTED

First ranking:

Highest Stage.

Implement:

Redis active leaderboard
PostgreSQL snapshots
pagination
player position
tie handling.

---

# Phase 11 — Tower of Eternity

Status: NOT STARTED

Implement:

endless tower
separate progression
roguelite blessings
Tower leaderboard.

---

# Phase 12 — Guilds

Status: NOT STARTED

Implement:

guild creation
membership
roles
invitations
progression
basic leaderboard.

---

# Phase 13 — World Boss

Status: NOT STARTED

Implement:

global boss
event duration
contribution
damage ranking
rewards
worker processing.

---

# Phase 14 — Arena PvP

Status: NOT STARTED

Implement:

asynchronous PvP
build snapshots
deterministic combat
rating
matchmaking
rewards.

---

# Phase 15 — Seasons

Status: NOT STARTED

Implement:

season definition
start/end
season progression
season modifiers
leaderboard
rewards
archival snapshot.

---

# Phase 16 — Eternal Forge

Status: NOT STARTED

Implement advanced crafting:

craft
upgrade
reroll
socket
rune
corrupt
awaken
ascend.

Operations must be:

server-authoritative
transactional
idempotent
auditable.

---

# Phase 17 — Companions

Status: NOT STARTED

Implement:

definitions
instances
progression
skills
evolution
equipment.

---

# Phase 18 — Advanced Prestige

Status: NOT STARTED

Implement architecture for:

Rebirth
Ascension
Transcendence
Apotheosis.

Each layer should unlock meaningful mechanics.

---

# Phase 19 — Achievements

Status: NOT STARTED

Implement achievements capable of unlocking:

mechanics
passive branches
titles
build options
cosmetics.

---

# Phase 20 — Production Hardening

Status: NOT STARTED

Audit:

architecture
security
database
indexes
API
rate limiting
economy
idempotency
performance
caching
concurrency
race conditions
accessibility
responsive design
PWA
logging
monitoring
backups.

Run complete test suite.

Document technical debt.

---

# Phase completion procedure

When finishing any phase:

1. run lint,
2. run typecheck,
3. run unit tests,
4. run integration tests where relevant,
5. run E2E where relevant,
6. run production build,
7. perform self-review,
8. update documentation,
9. change phase status,
10. provide completion report,
11. STOP.

Never automatically begin the next phase.
