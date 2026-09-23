import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryGameRepository } from '../../../test/support/in-memory-game.repository.js';
import type { AuthenticatedIdentity } from '../../auth/application/authenticated-identity.js';
import { InvalidPlayerNameError } from '../domain/player-name.js';
import { GetPlayerStateUseCase } from './get-player-state.use-case.js';
import { ProvisionPlayerUseCase } from './provision-player.use-case.js';

const clock = { now: () => new Date('2026-09-22T12:00:00.000Z') };

function identity(): AuthenticatedIdentity {
  return { authUserId: randomUUID(), sessionId: undefined };
}

function setup() {
  const repository = new InMemoryGameRepository();
  return {
    provision: new ProvisionPlayerUseCase(repository, clock),
    getState: new GetPlayerStateUseCase(repository, clock),
  };
}

describe('ProvisionPlayerUseCase', () => {
  it('creates a profile and a level-1, stage-1 main character', async () => {
    const { provision } = setup();

    const result = await provision.execute(identity(), {
      displayName: 'Kael',
      characterName: 'Ember',
    });

    expect(result.created).toBe(true);
    expect(result.player.profile.displayName).toBe('Kael');
    expect(result.player.mainCharacter).toMatchObject({
      name: 'Ember',
      slot: 1,
      level: 1,
    });
    expect(result.player.mainCharacter.stage.toString()).toBe('1');
    expect(result.serverTime).toEqual(clock.now());
  });

  it('binds the player to the verified identity only', async () => {
    const { provision } = setup();
    const caller = identity();

    const result = await provision.execute(caller, { displayName: 'Kael', characterName: 'Ember' });

    expect(result.player.profile.authUserId).toBe(caller.authUserId);
  });

  it('is idempotent: a repeat returns the same player and keeps the first names', async () => {
    const { provision } = setup();
    const caller = identity();

    const first = await provision.execute(caller, { displayName: 'Kael', characterName: 'Ember' });
    const second = await provision.execute(caller, {
      displayName: 'Other',
      characterName: 'Other',
    });

    expect(second.created).toBe(false);
    expect(second.player).toEqual(first.player);
  });

  it('normalises names before storing them', async () => {
    const { provision } = setup();

    const result = await provision.execute(identity(), {
      displayName: '  Aëlith ',
      characterName: 'Ember',
    });

    expect(result.player.profile.displayName).toBe('Aëlith');
  });

  it('refuses an invalid name even if transport validation was bypassed', async () => {
    const { provision } = setup();

    await expect(
      provision.execute(identity(), { displayName: 'x', characterName: 'Ember' }),
    ).rejects.toBeInstanceOf(InvalidPlayerNameError);
  });
});

describe('GetPlayerStateUseCase', () => {
  it('reports an identity without a player as not provisioned', async () => {
    const { getState } = setup();

    await expect(getState.execute(identity())).resolves.toEqual({ kind: 'not-provisioned' });
  });

  it("returns the caller's own player and never another's", async () => {
    const { provision, getState } = setup();
    const alice = identity();
    const bob = identity();
    await provision.execute(alice, { displayName: 'Alice', characterName: 'Ember' });
    await provision.execute(bob, { displayName: 'Bob', characterName: 'Frost' });

    const result = await getState.execute(bob);

    expect(result.kind === 'found' && result.player.profile.displayName).toBe('Bob');
  });
});
