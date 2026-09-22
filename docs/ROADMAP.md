# Eternal Forge — Development Roadmap

Last updated: 2026-09-22

# Current Phase

PHASE 0 — FOUNDATION

Status:

IN PROGRESS — local re-validation passed; awaiting green GitHub Actions on
`main`, then user approval

Phase 0 was marked COMPLETE on 2026-09-22, but the first CI run on `main` after
the merge failed (`Lint, typecheck, unit tests, build`). Green CI is a
completion requirement, so the status was reverted until CI passes on GitHub.
See "CI re-validation" under Phase 0.

One task could not be executed from the development environment and is carried
forward; see "Carried forward" under Phase 0.

Claude must NOT begin another phase without explicit user approval.

---

# Phase 0 — Foundation

Status: IN PROGRESS — awaiting green GitHub Actions (one task carried forward)

Goal:

Create a production-quality project foundation.

Tasks:

- [x] initialize pnpm workspace — with a `catalog:` for shared dependency versions
- [x] configure Turborepo
- [x] create apps/web — Next.js 16, App Router, Tailwind v4
- [x] create apps/api — NestJS 12, layered health module
- [x] create apps/worker — BullMQ worker
- [x] create packages/game-core — boundary and guard rails only, no gameplay
- [x] create packages/contracts — health transport contracts
- [x] create packages/database — Prisma 7 + `pg` adapter, Supabase clients
- [x] create packages/ui — design tokens, Button, Panel, StatusBadge
- [x] create shared configuration — packages/typescript-config, packages/eslint-config
- [x] configure strict TypeScript
- [x] configure ESLint — including Game Core purity rules
- [x] configure formatting — Prettier, checked in CI
- [x] configure environment validation — packages/config, server/client split
- [x] prepare PostgreSQL integration — Prisma schema (no models), client factory, readiness probe
- [x] prepare Redis integration — per-process connections, readiness probe, BullMQ transport
- [x] prepare Supabase integration — privileged and public client factories, credential schemas
- [x] add API health endpoint — `/health` (liveness) and `/health/ready` (readiness, 503 on failure)
- [x] add web health/start page — `/`, `/status`, and `/api/health`
- [x] add worker smoke mechanism — `pnpm --filter @eternal-forge/worker run smoke`
- [x] configure Vitest — every package; SWC transform in apps/api for decorator metadata
- [x] configure Playwright skeleton — mobile (390x844) and desktop projects
- [x] configure GitHub Actions — quality, end-to-end and backing-services smoke jobs
- [x] create ADRs — ADR-001 … ADR-013
- [x] validate lint
- [x] validate typecheck
- [x] validate tests
- [x] validate build
- [x] fix CI on a clean checkout — Prisma generation is a Turborepo task (ADR-014)
- [x] re-validate locally, including on a fresh clone with no generated client
- [ ] GitHub Actions green on `main` — PENDING, not yet observed
- [ ] deploy initial web application to Vercel — CARRIED FORWARD

CI re-validation (2026-09-22):

The first CI run on `main` failed in the Lint step. Type-aware ESLint reported
`new PrismaClient(...)` in `packages/database` as an unsafe construction of an
unresolved type. The cause was the task graph, not the code. `lint` did not
depend on `prisma generate`, and on a clean checkout the generated client did
not exist yet. `test` had the same gap, hidden by step order. Fixed by making
generation an explicit task that `build`, `typecheck`, `lint`, `test` and `dev`
depend on (ADR-014). No lint rule was disabled and no generated code was
committed.

Verified locally on a fresh clone after `git clean -fdx`: each of `lint`,
`typecheck`, `test` and `build` succeeds as the first command, and so do all
four together. Also passing: format check, 87 unit and integration tests, 8
Playwright tests (mobile and desktop), production build, and the
PostgreSQL/Redis smoke test (readiness 200 with both up, 503 with Redis down;
worker job round trip).

The self-review removed unused workspace dependencies: `game-core` and `zod`
from `apps/api`; `game-core`, `database` and `contracts` from `apps/worker`.

Phase 0 is complete only when the CI run for this change is green on GitHub
**and** the user approves.

Carried forward:

**Deploy initial web application to Vercel.** Requires Vercel account access,
which the development environment does not have. Everything needed is in the
repository: `apps/web/vercel.json`, and the project settings are documented in
ADR-012. The step is a dashboard action — import the repository, set the root
directory to `apps/web` — not a code change.

Do NOT implement gameplay.

Completion requires user approval.

---

# Phase 1 — Game Core Foundation

Status: NOT STARTED — blocked on user approval

Goal:

Create the first deterministic headless game simulation.

Entry requirement: ADR-013 (large-number representation, persistence format and
leaderboard ordering key) must be decided before this phase completes, because
HugeNumber's representation constrains both storage and every ranking derived
from it.

ADR-013 now contains a concrete recommendation with six open questions. It is
still Proposed and needs the user's answers before `HugeNumber` is implemented.

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
