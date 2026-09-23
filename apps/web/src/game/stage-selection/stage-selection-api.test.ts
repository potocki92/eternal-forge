import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { ApiError } from '@/lib/api-client';
import { CHARACTER_ID, playerStateFixture } from '@/test/fixtures';
import { selectStage } from './stage-selection-api';

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

function selectionResponse() {
  const state = playerStateFixture();
  return {
    character: state.character,
    progression: { ...state.progression, stageMode: 'FARM' },
    serverTime: state.serverTime,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selectStage', () => {
  it('PUTs the intent — and only the intent — to the character’s stage selection', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(selectionResponse(), 200)));
    vi.stubGlobal('fetch', fetchMock);

    const response = await selectStage(tokens, CHARACTER_ID, {
      mode: 'FARM',
      stage: '9007199254740993',
    });

    expect(response.progression.stageMode).toBe('FARM');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/player/characters/${CHARACTER_ID}/stage-selection`);
    expect(init.method).toBe('PUT');
    // The stage travels as the exact string, never as a rounded number.
    expect(init.body).toBe('{"mode":"FARM","stage":"9007199254740993"}');
    expect(init.headers).toMatchObject({ authorization: 'Bearer access-token' });
  });

  it('reports STAGE_LOCKED with the API’s message', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        json(
          {
            statusCode: 409,
            code: 'STAGE_LOCKED',
            error: 'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
          },
          409,
        ),
      ),
    );

    await expect(
      selectStage(tokens, CHARACTER_ID, { mode: 'FARM', stage: '11' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'STAGE_LOCKED',
      message: 'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
    });
  });

  it('refuses a response that breaks the contract', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        json(
          {
            ...selectionResponse(),
            progression: { ...selectionResponse().progression, currentStage: '5' },
          },
          200,
        ),
      ),
    );

    await expect(selectStage(tokens, CHARACTER_ID, { mode: 'PROGRESS' })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
