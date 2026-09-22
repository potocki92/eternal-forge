# Eternal Forge — Security Model

Status: PLANNED / EVOLVING

Eternal Forge is a competitive online game.

Assume the client is hostile.

---

# Primary principle

Never trust the client.

The browser can be:

modified,
automated,
reverse engineered,
replayed,
intercepted.

Frontend validation exists for UX.

Backend validation exists for security.

---

# Server authority

Server controls:

damage
combat results
rewards
XP
currency
drops
upgrades
crafting
prestige
PvP
leaderboards.

Client-provided results are never authoritative.

---

# Authentication

Supabase Auth is the initial authentication provider.

Backend must validate authenticated identity.

Never accept an arbitrary playerId as proof of identity.

Example:

BAD:

POST /upgrade

{
  "playerId": "123",
  "itemId": "abc"
}

and trust playerId.

Instead derive player identity from authenticated context.

---

# Authorization

Authentication answers:

Who are you?

Authorization answers:

Are you allowed to perform this operation?

Every player-owned resource must validate ownership.

Examples:

items
characters
guild operations
rewards
settings.

---

# Input validation

Validate all external input.

Use Zod/shared contracts where appropriate.

Backend must independently validate gameplay constraints.

---

# Economy

Economy operations must be atomic.

Important operations should be:

transactional
idempotent
auditable.

Examples:

purchase
upgrade
craft
prestige
claim reward.

---

# Idempotency

Network retries must not duplicate rewards.

Example:

ClaimOfflineReward request sent twice

must produce:

one reward.

Not:

two rewards.

---

# Race conditions

Assume a malicious or accidental client can send multiple requests
simultaneously.

Examples:

upgrade item 20 times
claim reward 10 times
equip/sell same item concurrently.

Use appropriate transactional/concurrency protection.

---

# Rate limiting

Apply rate limiting to sensitive/high-frequency endpoints.

Do not rely on UI cooldowns.

Exact limits should be based on endpoint semantics.

---

# Leaderboards

Leaderboard values must originate from server-verified state.

Never accept:

{
  "stage": 999999
}

from the browser and insert it into ranking.

---

# Offline progress

Use server time.

Do not trust device clock.

Validate:

last processed state
maximum offline duration
progress rules.

---

# Deterministic combat

Deterministic simulation enables:

reproduction
validation
testing
potential replay verification.

Seeds must not allow clients to freely manipulate rewards.

---

# Secrets

Never commit:

.env
API secrets
service role keys
database credentials
private tokens.

Provide:

.env.example

with placeholder values.

---

# Supabase

Never expose privileged service credentials to the browser.

Public browser configuration and privileged server configuration must remain
separate.

Use database access controls/RLS where appropriate.

RLS is defense-in-depth, not an excuse to skip backend authorization.

---

# Logging

Never log:

passwords
access tokens
refresh tokens
service keys
full sensitive authentication headers.

Use structured logs.

Use correlation/request IDs.

---

# Error handling

Do not expose:

stack traces
database credentials
internal SQL
secrets

to production clients.

Return safe application errors.

Log appropriate internal details server-side.

---

# Dependencies

Keep dependencies maintained.

Use automated dependency/security scanning where practical.

Do not automatically apply breaking dependency upgrades without validation.

---

# Anti-cheat philosophy

Do not attempt to hide game formulas as the primary defense.

Assume players can understand client code.

Security comes from:

server authority
validation
transactions
rate limits
deterministic rules
auditability.

---

# Security review

Every major economy or competitive feature should answer:

Can the client fake it?

Can it be replayed?

Can it be called concurrently?

Can rewards be duplicated?

Can another player's resource be targeted?

Can invalid numeric values enter the system?

Can the operation leave partial state?

If any answer is uncertain, the feature is not finished.
