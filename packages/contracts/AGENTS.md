# Eternal Forge Contracts — Agent Instructions

These instructions apply to `packages/contracts`.

Read the repository root `AGENTS.md` first.

This package defines stable wire contracts between Eternal Forge components.

It must not become a gameplay engine.

---

# 1. Purpose

Contracts define:

- request schemas
- response schemas
- wire-safe primitive representations
- stable API error codes where appropriate

Use Zod according to existing project conventions.

---

# 2. No Gameplay Logic

Do not implement gameplay calculations here.

Do not calculate:

- damage
- rewards
- progression
- stage scaling
- combat outcomes

Contracts validate and describe data.

Game Core determines gameplay.

---

# 3. Stage Values

Authoritative stage values must use canonical decimal strings on the wire.

Do not use JavaScript numbers for StageNumber wire representation.

Preserve:

- currentStage
- highestStageReached
- highestStageCleared

as distinct concepts.

If highestStageCleared can represent "nothing cleared yet", preserve the accepted nullable representation.

---

# 4. HugeNumber

Use the project's canonical wire representation for HugeNumber.

Do not convert large authoritative values to floating-point numbers.

---

# 5. Stability

Treat public contract changes as meaningful API changes.

When changing a contract:

1. inspect API producers,
2. inspect web consumers,
3. update tests,
4. consider backward compatibility where relevant.

---

# 6. Dependencies

Keep this package lightweight.

Do not introduce infrastructure/framework dependencies without strong justification.

Do not make contracts depend on React, NestJS, Prisma, Supabase or PixiJS.

If sharing a pure primitive/domain representation with Game Core is already an accepted architecture decision, preserve the existing dependency direction rather than inventing a new one.

---

# 7. Validation

Schemas should reject malformed or ambiguous representations.

Prefer canonical formats.

Do not silently coerce unsafe numeric values into authoritative state.
