import { z } from 'zod';
import { playerNameSchema } from './player-name.js';

/**
 * Transport contracts for the authenticated player's own state.
 *
 * None of these shapes carries identity input. The API derives the caller from
 * the verified access token; a client cannot name the player it acts for
 * (docs/SECURITY.md — "Authentication").
 */

export const profileSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
});
export type ProfileDto = z.infer<typeof profileSchema>;

/**
 * A character's persistent source state. Derived values such as combat stats
 * are computed from it by Game Core and are deliberately not part of this shape.
 */
export const characterSchema = z.object({
  id: z.uuid(),
  slot: z.number().int().min(1),
  name: z.string(),
  level: z.number().int().min(1),
  /** Current stage. Unbounded in the game; safe-integer on the wire. */
  stage: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime(),
});
export type CharacterDto = z.infer<typeof characterSchema>;

/** `GET /player/state` — everything the client needs to render the player shell. */
export const playerStateResponseSchema = z.object({
  profile: profileSchema,
  character: characterSchema,
  /** Server time, ISO-8601. The server clock is authoritative. */
  serverTime: z.iso.datetime(),
});
export type PlayerStateResponse = z.infer<typeof playerStateResponseSchema>;

/**
 * `POST /player` — idempotent provisioning of the caller's profile and main
 * character. Repeating the request returns the existing player unchanged: the
 * first successful request's names win.
 */
export const provisionPlayerRequestSchema = z.strictObject({
  displayName: playerNameSchema,
  characterName: playerNameSchema,
});
/** What a client sends (before normalisation). */
export type ProvisionPlayerRequest = z.input<typeof provisionPlayerRequestSchema>;

/** `GET /player/characters/:characterId` — one of the caller's own characters. */
export const characterResponseSchema = z.object({ character: characterSchema });
export type CharacterResponse = z.infer<typeof characterResponseSchema>;
