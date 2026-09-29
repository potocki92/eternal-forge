import {
  characterStatsResponseSchema,
  statsPreviewResponseSchema,
  type CharacterStatsResponse,
  type StatsPreviewQuery,
  type StatsPreviewResponse,
} from '@eternal-forge/contracts';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { authorizedJson } from '@/lib/api-client';

const base = (characterId: string) => `/player/characters/${encodeURIComponent(characterId)}/stats`;

/** The character's current, server-resolved stats (ADR-030). */
export function fetchCharacterStats(
  tokens: AccessTokenSource,
  characterId: string,
  signal?: AbortSignal,
): Promise<CharacterStatsResponse> {
  return authorizedJson(tokens, {
    path: base(characterId),
    schema: characterStatsResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * The stats after one equip or unequip, computed and compared on the server.
 * Only the intent travels: an item id to equip or a slot to empty.
 */
export function fetchStatsPreview(
  tokens: AccessTokenSource,
  characterId: string,
  intent: StatsPreviewQuery,
  signal?: AbortSignal,
): Promise<StatsPreviewResponse> {
  const query = new URLSearchParams(
    'equip' in intent ? { equip: intent.equip } : { unequip: intent.unequip },
  );
  return authorizedJson(tokens, {
    path: `${base(characterId)}/preview?${query.toString()}`,
    schema: statsPreviewResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
