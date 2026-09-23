# Eternal Forge Web — Agent Instructions

These instructions apply to `apps/web`.

Read the repository root `AGENTS.md` first.

The web application is a presentation client.

It is not gameplay authority.

---

# 1. Authority

Never calculate authoritative:

- damage
- enemy stats
- victory
- defeat
- rewards
- XP
- gold
- stage advancement
- boss determination
- RNG outcomes

in the frontend.

The frontend requests actions and renders authoritative server results.

---

# 2. React Responsibilities

React owns:

- application shell
- routing
- authentication UX
- API state
- menus
- overlays
- accessible controls
- textual gameplay status

React should not become a second Game Core.

---

# 3. PixiJS Responsibilities

PixiJS owns combat visualization and animation.

Examples:

- hero rendering
- enemy rendering
- attack animation
- hit effects
- damage feedback
- death animation
- victory presentation

PixiJS consumes authoritative combat results.

PixiJS must never determine gameplay outcomes.

---

# 4. Pixi Lifecycle

Prevent:

- duplicate Pixi applications
- duplicate animation loops
- leaked textures
- leaked listeners
- leaked canvases

Destroy Pixi resources correctly on unmount.

React rerenders must not recreate the entire Pixi application unnecessarily.

---

# 5. API State

Use the established TanStack Query architecture.

Do not create a competing global gameplay state system without architectural justification.

After gameplay mutation:

- update or invalidate authoritative player state,
- avoid stale progression,
- handle retries safely.

---

# 6. Authentication State

Logout must immediately remove previous player data from UI.

Account switching must not display cached data from the previous account.

Expired/invalid sessions must transition safely to unauthenticated state.

---

# 7. Stage Progression UI

Distinguish:

currentStage
highestStageReached
highestStageCleared

Do not assume currentStage equals the player's historical maximum.

CurrentStage is the active/farming stage.

HighestStageCleared represents progression record.

Future rankings will normally use highestStageCleared.

---

# 8. Numeric Serialization

Stage values arrive as canonical decimal strings.

Do not casually convert them to JavaScript number.

For display, use bigint-safe formatting where necessary.

Do not lose authoritative precision.

---

# 9. Mobile First

Primary viewport:

390 × 844.

Design and test mobile first.

Desktop must remain functional.

Avoid overcrowding the game screen.

The application should visually feel like a game, not an admin dashboard.

---

# 10. Accessibility

Canvas does not replace accessible DOM.

Important gameplay state must be available outside PixiJS.

Examples:

- current stage
- enemy
- combat state
- victory/defeat
- rewards
- loading/error state

Do not make automated tests depend exclusively on canvas pixels.

---

# 11. Duplicate Actions

Disable/protect mutation controls appropriately while an action is being processed.

UI protection is convenience only.

Correctness must still be guaranteed server-side through idempotency/concurrency.

---

# 12. Error UX

Handle explicitly:

- loading
- API unavailable
- retryable network error
- expired authentication
- conflict
- combat pending
- victory
- defeat

Do not expose raw backend errors or stack traces.

---

# 13. Shared Contracts

Use `packages/contracts`.

Do not independently recreate API response types when a shared contract exists.

Validate external/API data at appropriate boundaries.

---

# 14. Tests

Relevant web changes should consider:

- 390 × 844
- desktop
- authentication
- refresh
- logout
- account switch
- gameplay mutation
- progression update
- error states

Prefer semantic DOM assertions over fragile pixel-perfect canvas tests.
