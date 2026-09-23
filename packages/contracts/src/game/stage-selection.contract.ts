import { z } from 'zod';
import { characterSchema } from '../player/player.contract.js';
import { stageNumberSchema } from '../stage/stage-number.contract.js';
import { progressionSchema } from './progression.contract.js';

/**
 * `PUT /player/characters/:characterId/stage-selection` — where the hero
 * fights next (ADR-021).
 *
 * The request states an intent. The server decides whether it is allowed: a
 * farm stage must be one the character has already reached, and "climb"
 * always resumes from the character's own frontier. Nothing in the request
 * can raise a record, grant a reward or choose an enemy.
 *
 * - `{ "mode": "PROGRESS" }` — continue climbing from the highest stage
 *   reached. There is no stage to send: the server knows the frontier.
 * - `{ "mode": "FARM", "stage": "42" }` — stay on stage 42. The stage is a
 *   canonical decimal string, exact to 2^63 − 1 (ADR-018).
 *
 * Both shapes are strict: any other field — a record, a reward, a level — is
 * a validation error, not something silently dropped.
 */
export const stageSelectionRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('PROGRESS') }),
  z.strictObject({ mode: z.literal('FARM'), stage: stageNumberSchema }),
]);
export type StageSelectionRequest = z.infer<typeof stageSelectionRequestSchema>;

/** The character as the selection left it, with its derived progression. */
export const stageSelectionResponseSchema = z.object({
  character: characterSchema,
  progression: progressionSchema,
  /** Server time, ISO-8601. */
  serverTime: z.iso.datetime(),
});
export type StageSelectionResponse = z.infer<typeof stageSelectionResponseSchema>;
