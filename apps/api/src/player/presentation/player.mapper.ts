import type { CharacterDto, PlayerStateResponse } from '@eternal-forge/contracts';
import type { Character, Player } from '../domain/player.js';

/** Domain → shared contract. The internal `authUserId` never leaves the API. */
export function toPlayerStateResponse(player: Player, serverTime: Date): PlayerStateResponse {
  return {
    profile: {
      id: player.profile.id,
      displayName: player.profile.displayName,
      createdAt: player.profile.createdAt.toISOString(),
    },
    character: toCharacterDto(player.mainCharacter),
    serverTime: serverTime.toISOString(),
  };
}

export function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    slot: character.slot,
    name: character.name,
    level: character.level,
    stage: character.stage.toString(),
    createdAt: character.createdAt.toISOString(),
  };
}
