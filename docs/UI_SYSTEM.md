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

PLANNED: everything else in this document, including bottom navigation, the
combat screen, item presentation and the PixiJS scene.

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
Skeleton (Phase 2, for the account forms and loading states). Each exists
because a screen needed it.

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

Status: PLANNED. The formatter is written with the first screen that displays a
HugeNumber (Phase 3), in the UI layer, not in Game Core.
