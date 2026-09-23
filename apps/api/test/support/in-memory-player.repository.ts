import { randomUUID } from 'node:crypto';
import type {
  PlayerRepository,
  ProvisionPlayerData,
  ProvisionPlayerOutcome,
} from '../../src/player/application/ports/player-repository.port.js';
import {
  MAIN_CHARACTER_SLOT,
  type Character,
  type Player,
  type Profile,
} from '../../src/player/domain/player.js';

/**
 * In-memory {@link PlayerRepository} with the port's documented semantics:
 * owner-scoped reads and idempotent provisioning.
 *
 * Used where a test is about the layers above persistence. The PostgreSQL
 * adapter is covered against a real database in `test-integration/`.
 */
export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly profiles = new Map<string, Profile>();
  private readonly characters: Character[] = [];

  constructor(private readonly now: () => Date = () => new Date('2026-09-22T10:00:00.000Z')) {}

  findByAuthUserId(authUserId: string): Promise<Player | null> {
    const profile = this.profiles.get(authUserId);
    const mainCharacter = profile && this.characterIn(profile.id, MAIN_CHARACTER_SLOT);

    return Promise.resolve(profile && mainCharacter ? { profile, mainCharacter } : null);
  }

  findOwnedCharacter(authUserId: string, characterId: string): Promise<Character | null> {
    const profile = this.profiles.get(authUserId);
    const character = this.characters.find(
      (candidate) => candidate.id === characterId && candidate.profileId === profile?.id,
    );

    return Promise.resolve(character ?? null);
  }

  provision(data: ProvisionPlayerData): Promise<ProvisionPlayerOutcome> {
    let created = false;
    let profile = this.profiles.get(data.authUserId);

    if (profile === undefined) {
      profile = {
        id: randomUUID(),
        authUserId: data.authUserId,
        displayName: data.displayName,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.profiles.set(data.authUserId, profile);
      created = true;
    }

    let mainCharacter = this.characterIn(profile.id, data.characterSlot);
    if (mainCharacter === undefined) {
      mainCharacter = {
        id: randomUUID(),
        profileId: profile.id,
        slot: data.characterSlot,
        name: data.characterName,
        level: data.characterLevel,
        stage: data.characterStage,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.characters.push(mainCharacter);
      created = true;
    }

    return Promise.resolve({ player: { profile, mainCharacter }, created });
  }

  private characterIn(profileId: string, slot: number): Character | undefined {
    return this.characters.find(
      (character) => character.profileId === profileId && character.slot === slot,
    );
  }
}
