import { describe, expect, it } from 'vitest';
import { InMemorySkillRepository } from '../../../test/support/in-memory-skill.repository.js';
import {
  GetSkillStateUseCase,
  SET_SKILL_LOADOUT_MAX_ATTEMPTS,
  SetSkillLoadoutUseCase,
} from './skill.use-cases.js';

const identity = { authUserId: 'owner', sessionId: undefined };
const stranger = { authUserId: 'stranger', sessionId: undefined };

async function fixture(owned: Record<string, number> = {}) {
  const repository = new InMemorySkillRepository();
  const characterId = repository.addCharacter('owner');
  await repository.grant(characterId, owned);
  return {
    repository,
    characterId,
    get: new GetSkillStateUseCase(repository),
    set: new SetSkillLoadoutUseCase(repository),
  };
}

function ids(skills: readonly { id: { toString(): string } }[]): string[] {
  return skills.map((skill) => skill.id.toString());
}

describe('GetSkillStateUseCase', () => {
  it('returns the intentional empty state for a character without skills', async () => {
    const { get, characterId } = await fixture();
    const result = await get.execute(identity, characterId);
    expect(result).toMatchObject({ kind: 'found', state: { version: 0n } });
    if (result.kind !== 'found') return;
    expect(result.state.skills.owned).toEqual([]);
    expect(result.state.skills.loadout).toEqual([]);
  });

  it('returns owned skills in catalog order with their persisted levels', async () => {
    const { get, characterId } = await fixture({ shield: 2, fireball: 1, execute: 3 });
    const result = await get.execute(identity, characterId);
    if (result.kind !== 'found') throw new Error('expected found');
    expect(ids(result.state.skills.owned)).toEqual(['fireball', 'execute', 'shield']);
    expect(result.state.skills.owned.map((skill) => skill.level.toNumber())).toEqual([1, 3, 2]);
  });

  it('hides a foreign or missing character', async () => {
    const { get, characterId } = await fixture({ fireball: 1 });
    expect(await get.execute(stranger, characterId)).toEqual({ kind: 'not-found' });
    expect(await get.execute(identity, 'missing')).toEqual({ kind: 'not-found' });
  });

  it('fails explicitly on a persisted skill the catalog does not know', async () => {
    const { get, repository, characterId } = await fixture();
    repository.storeRaw(characterId, { owned: { meteor: 1 } });
    await expect(get.execute(identity, characterId)).rejects.toMatchObject({
      code: 'UNKNOWN_SKILL_DEFINITION',
    });
  });

  it('fails explicitly on a persisted loadout entry the character does not own', async () => {
    const { get, repository, characterId } = await fixture({ fireball: 1 });
    repository.storeRaw(characterId, { loadout: ['shield'] });
    await expect(get.execute(identity, characterId)).rejects.toMatchObject({
      code: 'SKILL_NOT_OWNED',
    });
  });
});

describe('SetSkillLoadoutUseCase', () => {
  it('equips owned skills in the requested priority order and advances the version once', async () => {
    const { set, get, repository, characterId } = await fixture({
      fireball: 1,
      execute: 3,
      shield: 2,
    });
    const before = repository.versionOf(characterId);
    const result = await set.execute(identity, characterId, ['execute', 'fireball', 'shield']);
    if (result.kind !== 'found') throw new Error(`expected found, got ${result.kind}`);
    expect(ids(result.state.skills.loadout)).toEqual(['execute', 'fireball', 'shield']);
    expect(result.state.skills.loadout.map((skill) => skill.level.toNumber())).toEqual([3, 1, 2]);
    expect(result.state.version).toBe(before + 1n);
    expect(repository.versionOf(characterId)).toBe(before + 1n);
    // The answer is exactly what a fresh read sees.
    expect(await get.execute(identity, characterId)).toEqual(result);
  });

  it('replaces the whole loadout rather than patching slots', async () => {
    const { set, characterId } = await fixture({
      fireball: 1,
      execute: 3,
      shield: 2,
      whirlwind: 1,
    });
    await set.execute(identity, characterId, ['execute', 'fireball', 'shield']);
    const result = await set.execute(identity, characterId, ['whirlwind', 'fireball']);
    if (result.kind !== 'found') throw new Error('expected found');
    expect(ids(result.state.skills.loadout)).toEqual(['whirlwind', 'fireball']);
  });

  it('accepts an empty loadout and owned skills stay owned', async () => {
    const { set, characterId } = await fixture({ fireball: 1 });
    await set.execute(identity, characterId, ['fireball']);
    const result = await set.execute(identity, characterId, []);
    if (result.kind !== 'found') throw new Error('expected found');
    expect(result.state.skills.loadout).toEqual([]);
    expect(ids(result.state.skills.owned)).toEqual(['fireball']);
  });

  it('treats the same loadout in the same order as a no-op: no write, no version change', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1, execute: 3 });
    await set.execute(identity, characterId, ['execute', 'fireball']);
    const version = repository.versionOf(characterId);
    const writes = repository.replacements;
    const repeated = await set.execute(identity, characterId, ['execute', 'fireball']);
    expect(repeated).toMatchObject({ kind: 'found', state: { version } });
    expect(repository.replacements).toBe(writes);
    expect(repository.versionOf(characterId)).toBe(version);
    // An empty loadout on a fresh character is a no-op too.
    const fresh = await fixture({ fireball: 1 });
    await fresh.set.execute(identity, fresh.characterId, []);
    expect(fresh.repository.replacements).toBe(0);
  });

  it('a new order of the same skills is a real change', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1, execute: 3 });
    await set.execute(identity, characterId, ['execute', 'fireball']);
    await set.execute(identity, characterId, ['fireball', 'execute']);
    expect(repository.replacements).toBe(2);
  });

  it.each([
    [['whirlwind', 'fireball', 'execute', 'blood_strike', 'shield'], 'TOO_LARGE'],
    [['fireball', 'fireball'], 'DUPLICATE'],
    [['meteor'], 'UNKNOWN_SKILL'],
    [['Fireball'], 'MALFORMED_ID'],
    [['fire-ball'], 'MALFORMED_ID'],
  ] as const)('refuses %j as %s without writing', async (skillIds, reason) => {
    const { set, repository, characterId } = await fixture({
      whirlwind: 1,
      fireball: 1,
      execute: 1,
      blood_strike: 1,
      shield: 1,
    });
    const version = repository.versionOf(characterId);
    expect(await set.execute(identity, characterId, skillIds)).toEqual({
      kind: 'invalid',
      reason,
    });
    expect(repository.versionOf(characterId)).toBe(version);
    expect(repository.replacements).toBe(0);
  });

  it('refuses a known skill the character does not own, without dropping it silently', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1 });
    expect(await set.execute(identity, characterId, ['fireball', 'shield'])).toEqual({
      kind: 'not-owned',
    });
    expect(repository.replacements).toBe(0);
  });

  it('hides a foreign character and writes nothing', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1 });
    expect(await set.execute(stranger, characterId, ['fireball'])).toEqual({ kind: 'not-found' });
    expect(repository.replacements).toBe(0);
  });

  it('re-validates against the fresh state after a version conflict', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1, shield: 1 });
    let competing = true;
    repository.beforeReplace = async () => {
      if (!competing) return;
      competing = false;
      // A concurrent trusted level change advances the version first.
      await repository.grant(characterId, { shield: 4 });
    };
    const result = await set.execute(identity, characterId, ['shield', 'fireball']);
    if (result.kind !== 'found') throw new Error(`expected found, got ${result.kind}`);
    expect(ids(result.state.skills.loadout)).toEqual(['shield', 'fireball']);
    // The answer carries the level the fresh state holds, not the stale one.
    expect(result.state.skills.loadout[0]?.level.toNumber()).toBe(4);
    expect(result.state.version).toBe(repository.versionOf(characterId));
    expect(repository.replacements).toBe(1);
  });

  it('gives up with a conflict when the character keeps changing', async () => {
    const { set, repository, characterId } = await fixture({ fireball: 1 });
    let level = 1;
    repository.beforeReplace = async () => {
      level += 1;
      await repository.grant(characterId, { fireball: level });
    };
    expect(await set.execute(identity, characterId, ['fireball'])).toEqual({ kind: 'conflict' });
    expect(repository.replacements).toBe(0);
    expect(level).toBe(1 + SET_SKILL_LOADOUT_MAX_ATTEMPTS);
  });
});
