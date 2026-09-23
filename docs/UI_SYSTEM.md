# Eternal Forge — UI & UX System

Status: EARLY DESIGN — foundations IMPLEMENTED (Phase 0)

IMPLEMENTED: design tokens (colour, typography, radius, elevation, motion,
layering, item rarity) as Tailwind v4 `@theme` variables in
`packages/ui/src/styles/tokens.css`, plus the `Alert`, `Button`, `Panel`,
`Skeleton`, `StatusBadge` and `TextField` primitives, a reduced-motion guard and
safe-area handling.

IMPLEMENTED (Phase 2): the account screens — sign-in, registration, first-run
"Name your hero" onboarding and a simple player shell (display name, hero,
level, stage, sign-out). They are mobile-first single-column layouts verified at
390x844 and on desktop. This is not the final game UI.

IMPLEMENTED (Phase 3): the first game screen and the PixiJS combat scene —
see "Game screen (Phase 3)" at the end of this document — plus the
`ProgressBar` primitive and the HugeNumber formatter.

IMPLEMENTED (Phase 4 PR 4.1): the stage selector on the game screen — see
"Stage selector (Phase 4 PR 4.1)" at the end of this document.

PLANNED: everything else in this document, including bottom navigation, item
presentation and final art.

---

# Product direction

Eternal Forge is a game first.

The UI should feel immersive but remain extremely usable.

Avoid:

generic SaaS dashboard appearance
excessive glassmorphism
tiny desktop-first interfaces
overloaded mobile screens
dozens of unrelated card styles.

---

# Mobile first

Primary viewport:

390x844.

Every major feature must be designed for mobile first.

Then adapt to:

tablet
desktop.

---

# Navigation

Initial mobile navigation concept:

Combat
Character
Inventory
Forge
More

Do not permanently add every new feature to bottom navigation.

Secondary systems belong under contextual navigation or More.

---

# Desktop

Desktop may use:

sidebar
larger content area
additional contextual panels.

Do not create an entirely different application architecture.

---

# Combat screen

Combat is the primary gameplay screen.

Expected structure conceptually:

Top:
resources
stage
progress

Center:
CombatScene

Bottom/context:
skills
combat information
boss state

Persistent navigation:
bottom navigation on mobile.

Do not overload the combat scene with every account system.

---

# React vs PixiJS

React owns:

navigation
inventory
items
skills UI
rankings
settings
modals
forms
tooltips
menus.

PixiJS owns:

combat visualization
characters
enemies
combat effects
damage numbers
environment animation.

Game state does not originate from PixiJS.

---

# Design tokens

Use centralized design tokens.

Categories:

colors
spacing
typography
radius
shadows
z-index
breakpoints
animation durations.

Do not scatter arbitrary values throughout components.

---

# Semantic colors

Prefer semantic tokens.

Examples:

background
surface
surfaceElevated
textPrimary
textSecondary
primary
danger
success

Item rarity tokens:

common
magic
rare
epic
legendary
mythic

Do not use raw hex values repeatedly inside components.

---

# Components

packages/ui should provide reusable primitives.

Potential components:

Button
IconButton
GameCard
Panel
ProgressBar
ResourceBadge
StatRow
ItemCard
SkillCard
RankingRow
Modal
Dialog
Sheet
Tooltip
Tabs
BottomNavigation
Sidebar
Badge
Skeleton
EmptyState

Do not create all components immediately.

Create them as features require them.

IMPLEMENTED so far: Button, Panel, StatusBadge (Phase 0); TextField, Alert,
Skeleton (Phase 2, for the account forms and loading states); ProgressBar
(Phase 3, for health and experience: an ARIA progressbar with a name and value
text, `primary`/`success`/`danger`/`info` tones, reduced-motion aware). Each
exists because a screen needed it.

---

# Variants

Use variants.

Example:

Button

variant:
primary
secondary
danger
ghost

size:
sm
md
lg

Do not create:

RedButton
GreenButton
BigButton
SmallButton

as separate components.

---

# Item presentation

ItemCard should support:

rarity
icon
item level
upgrade level
equipped state
new state
comparison state.

Avoid duplicating item display logic across:

inventory
forge
equipment
rewards.

---

# Numbers

Idle RPG numbers become large.

Create shared formatting.

Examples:

1,240
12.4K
5.28M
8.31B

Later extremely large values may require scientific or named notation.

Formatting is presentation logic.

HugeNumber arithmetic remains in Game Core.

---

# Responsive behavior

Avoid simply shrinking desktop UI.

Mobile layouts may:

stack
collapse
use bottom sheets
hide secondary information behind details.

Primary actions must remain reachable.

---

# Touch

Touch targets must be comfortably usable.

Do not design interactions that require hover.

Hover may enhance desktop UX but cannot be required.

---

# Tooltips

Desktop:

hover/focus can show tooltip.

Mobile:

tap or contextual details must provide equivalent information.

---

# Accessibility

Use semantic HTML for application UI where practical.

Support:

keyboard navigation
focus states
accessible labels
reasonable contrast
reduced-motion preferences where appropriate.

Canvas/Pixi content must not be the only way important gameplay information is
communicated.

---

# Motion

Animation should communicate:

impact
reward
progress
state change.

Avoid constant visual noise.

Important animations:

critical hit
boss appearance
legendary drop
stage milestone
prestige.

Animation must not delay server state unnecessarily.

---

# Loading

Use:

skeletons
optimistic UI only where safe
clear pending states.

Never fake completion of server-authoritative economy operations.

---

# Error UX

Errors should tell the player what happened in useful language.

Do not display raw backend exceptions.

Implemented (Phase 2): Supabase Auth errors are mapped by error code to
fixed sentences (`describeAuthError`); API errors show the message from the
shared error contract, which the API writes for players. Transport failures
show a generic "could not be reached" message. A session that ends because it
expired returns the player to sign-in with "Your session has expired".

Important actions should recover gracefully.

---

# Performance

Mobile performance is a priority.

Avoid:

unnecessary rerenders
huge DOM lists
unoptimized animations
unbounded particles
loading all inventory assets immediately.

Virtualize large collections when necessary.

---

# PWA

The application should eventually support:

installable PWA
appropriate icons
manifest
mobile viewport behavior
safe areas
standalone mode.

Do not allow PWA concerns to distort Game Core.

---

# Visual direction

Target:

dark fantasy
premium
modern
clean
high contrast
strong item rarity identity.

Avoid making every surface ornate.

The gameplay content should carry visual richness while application chrome
remains readable.

Final art direction will be refined separately.

---

# Number formatting and HugeNumber

Formatting is presentation logic and belongs in the UI layer. Arithmetic belongs
to `HugeNumber` in Game Core.

The two are related by more than style: the representation chosen for
`HugeNumber` determines what the formatter receives. ADR-013 settled it on
2026-09-22: an 18-digit decimal coefficient and a scientific exponent, exposed by
`HugeNumber.toParts()`, and a canonical string on the wire. The web application
may import `HugeNumber` for parsing, comparison and those parts. It must not use
Game Core to compute gameplay outcomes (ADR-003).

Status: IMPLEMENTED (Phase 3) in `apps/web/src/game/format/format-huge.ts`.
Below 10 000 values are grouped with at most one decimal (`1,240`, `12.1`).
Above that come `K`, `M`, `B` and `T` with three significant digits (`12.4K`,
`5.28M`), then scientific notation (`1.23e15`). It reads the exact digits
from `HugeNumber.toParts()`, and it truncates rather than rounds, so a balance
is never overstated. `hugeRatio` turns two values into a bar width. It is a
presentation float that never feeds a rule.

IMPLEMENTED (ADR-018): stage numbers arrive as canonical decimal strings, and
`formatStage` in `apps/web` groups their digits through `BigInt` and
`Intl.NumberFormat`. It is exact at every stage and never converts to a
`number`.

---

# Game screen (Phase 3)

Status: IMPLEMENTED — the first game UI, not the final art direction.

Layout (390×844 first; centred and framed at desktop widths):

```
┌──────────────────────────────┐
│ PLAYER NAME         Sign out │  HUD: display name, hero name,
│ Hero name                    │  level + experience bar, gold,
│ Level 3 ▓▓▓▓░░░░░    Gold 1.2K│  stage (danger-tinted "Boss stage")
│ Stage 12           Best 11   │
├──────────────────────────────┤
│ Husk               30 / 40   │  DOM overlay: enemy name, boss badge,
│ ▓▓▓▓▓▓▓░░░░░░░░              │  health bar with numbers
│          (enemy)             │
│                              │  PixiJS canvas: actors, lunges, hit
│          (hero)              │  flashes, damage numbers, criticals,
│ Hero               96 / 100  │  deaths, victory burst, defeat vignette
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░               │
├──────────────────────────────┤
│ Victory! Stage 1 cleared …   │  aria-live report; reward chips;
│ [+5 gold] [+3 XP]  Next: …   │  next encounter
├──────────────────────────────┤
│ [          Fight          ]  │  one primary action (Skip while fighting)
└──────────────────────────────┘
```

Behaviour:

- **Stage and record.** The HUD shows the current stage and, compactly,
  "Best": the highest stage cleared, or "—" (announced as "none yet") before
  the first victory (ADR-020). After a boss defeat the stage drops back while
  "Best" stays. The row wraps rather than overflowing on narrow screens.
- **Server truth only.** Every value shown arrives in the player state or the
  combat response. The boss treatment comes from the server's stage `kind`.
  The screen never tests a stage number itself.
- **States:** loading (the existing skeleton), waiting, requesting ("Your
  hero charges in…"), fighting (live timeline; the HUD keeps the pre-combat
  values), finished (outcome banner, rewards, then the next enemy steps in
  after 1.2 s), and failed. The failures are: connection lost (retry with
  the same key), API unavailable (retry), still fighting (the state is
  re-read), and session ended (back to sign-in).
- **One action.** The Fight button is the only primary control. It is
  disabled while a combat is requested or playing, and it shows "Ready in Ns"
  until the server's pacing gate opens. It reads "Fight boss" (danger
  variant) on a boss stage. A synchronous guard means a double tap sends one
  request.
- **Bosses:** a danger-tinted stage badge and battlefield, a `Boss` badge, a
  larger health bar, a larger enemy with crown spikes and a pulsing aura, a
  heavier entrance with screen shake, and "Boss slain!" on victory.

React / PixiJS boundary (ADR-007):

```
GameScreen (React: state machine, playback clock, all information)
   │  showEncounter / playHit / showOutcome / destroy
   v
CombatScene interface  ──  PixiCombatScene (lazy import of pixi.js)
```

- The scene receives presentation cues only, and it can reject its creation
  (no WebGL, no canvas). The game then shows static silhouettes and stays
  fully playable.
- One scene per mounted screen. Creation is async and StrictMode-safe: a scene
  that finishes after unmount is destroyed at once. `destroy()` releases the
  renderer, the WebGL context, the ticker callback, the resize listener and
  every transient text or particle. Tests cover this lifecycle.
- The canvas is `aria-hidden`. The DOM carries names, health (ARIA
  progressbars), the outcome and a polite live report. End-to-end tests read
  those, never pixels.
- Reduced motion: the scene skips shakes, particles, lunges and idle
  breathing, and animations jump to their end state. CSS entrance animations
  follow the global reduced-motion guard. The pacing wait still applies,
  because it is a server rule.
- The scene's colours live in one palette module that mirrors the design
  tokens. Enemy looks are a data table keyed by archetype id, with a generic
  fallback, so new content never needs scene code.

---

# Stage selector (Phase 4 PR 4.1)

Status: IMPLEMENTED (ADR-021).

```
┌──────────────────────────────┐
│ HUD (unchanged)              │
├──────────────────────────────┤
│ Farming stage 42 · stays on  │  summary + [Change] (aria-expanded)
│ this stage          [Change] │
├──────────────────────────────┤  ── open: an overlay over the battlefield
│ Where should your hero fight?│     (fieldset + legend)
│ (•) Continue climbing        │     radio, described by its hint
│ ( ) Stay on this stage       │
│ Stage to farm                │
│ [ − ] [    42    ] [ + ]     │     bigint stepper + typed stage
│ Stages 1 to 100 are open.    │     hint; inline error when out of range
│ [Cancel]   [Farm stage 42]   │
└──────────────────────────────┘
```

- **Scales to any stage.** No list of stages is rendered: a stepper and a
  typed number work the same at stage 12 and at stage 12 billion. Stages stay
  canonical strings, compared and stepped as `BigInt`.
- **Server truth only.** The open range is the server's
  `highestStageReached`; the draft check is convenience. There is no
  optimistic update: the summary, the HUD and the next enemy change when the
  server's answer arrives, so a locked stage is never shown.
- **States.** Saving (button "Saving…", form `aria-busy`, Fight disabled),
  refused (danger `Alert` with the API's sentence, state re-read), locked
  while a combat plays ("Change" disabled), unchanged choice ("Already
  selected", disabled).
- **Keyboard and screen readers.** Native radios (arrow keys), labelled input
  with hint and error in `aria-describedby`, `aria-invalid`, focus moves to
  the checked choice on open and back to "Change" on close; Escape closes.
- **Layout.** At 390×844 the open form overlays the battlefield instead of
  squeezing it (found by screenshot review); on desktop it overlays the same
  framed column.
