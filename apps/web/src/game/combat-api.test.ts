import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { ApiError } from '@/lib/api-client';
import { CHARACTER_ID, combatResponseFixture } from '@/test/fixtures';
import { startCombat } from './combat-api';

const tokens: AccessTokenSource = {
  getAccessToken: () => Promise.resolve('access-token'),
  refreshAccessToken: () => Promise.resolve(null),
  expireSession: () => Promise.resolve(),
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startCombat', () => {
  it('posts to the character’s combats with the idempotency key and no body', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(combatResponseFixture(), 201)));
    vi.stubGlobal('fetch', fetchMock);

    const response = await startCombat(tokens, CHARACTER_ID, 'key-1');

    expect(response).toEqual(combatResponseFixture());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/player/characters/${CHARACTER_ID}/combats`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      'Idempotency-Key': 'key-1',
      authorization: 'Bearer access-token',
    });
  });

  it('accepts a replay (200) exactly like a new combat', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json(combatResponseFixture(), 200)));

    await expect(startCombat(tokens, CHARACTER_ID, 'key-1')).resolves.toEqual(
      combatResponseFixture(),
    );
  });

  it('reports COMBAT_NOT_READY with its code', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        json(
          { statusCode: 409, code: 'COMBAT_NOT_READY', error: 'Your hero is still fighting.' },
          409,
        ),
      ),
    );

    await expect(startCombat(tokens, CHARACTER_ID, 'key-1')).rejects.toMatchObject({
      status: 409,
      code: 'COMBAT_NOT_READY',
      message: 'Your hero is still fighting.',
    });
  });

  it('refuses a response that breaks the contract instead of rendering it', async () => {
    const tampered = { ...combatResponseFixture(), after: { gold: 999 } };
    vi.stubGlobal('fetch', () => Promise.resolve(json(tampered, 201)));

    await expect(startCombat(tokens, CHARACTER_ID, 'key-1')).rejects.toBeInstanceOf(ApiError);
  });
});
