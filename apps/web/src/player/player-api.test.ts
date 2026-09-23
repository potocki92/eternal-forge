import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { fetchPlayerState } from './player-api';

const tokens: AccessTokenSource = {
  getAccessToken: () => Promise.resolve('token'),
  refreshAccessToken: () => Promise.resolve('token'),
  expireSession: () => Promise.resolve(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPlayerState', () => {
  it('treats PLAYER_NOT_PROVISIONED as a state, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ statusCode: 404, code: 'PLAYER_NOT_PROVISIONED', error: 'None yet.' }),
            { status: 404 },
          ),
        ),
      ),
    );

    await expect(fetchPlayerState(tokens)).resolves.toEqual({ kind: 'not-provisioned' });
  });

  it('still fails on any other 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ statusCode: 404, code: 'NOT_FOUND', error: 'Nope.' }), {
            status: 404,
          }),
        ),
      ),
    );

    await expect(fetchPlayerState(tokens)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
