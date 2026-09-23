import { playerStateResponseSchema } from '@eternal-forge/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { ApiError, authorizedJson } from './api-client';

const baseUrl = 'http://api.test';

const state = {
  profile: {
    id: '5b0c8a3e-1f7b-4c1e-9a53-0d6f3c2b1a90',
    displayName: 'Kael',
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  character: {
    id: '0f9a2c7d-4b1e-4d2a-8c3f-6e5b4a392817',
    slot: 1,
    name: 'Ember',
    level: 1,
    stage: '1',
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  serverTime: '2026-09-22T10:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const unauthorized = () =>
  json({ statusCode: 401, code: 'UNAUTHENTICATED', error: 'The access token is invalid.' }, 401);

function tokens(overrides: Partial<AccessTokenSource> = {}) {
  return {
    getAccessToken: vi.fn(() => Promise.resolve<string | null>('token-1')),
    refreshAccessToken: vi.fn(() => Promise.resolve<string | null>('token-2')),
    expireSession: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn((_input: URL, _init?: RequestInit) => {
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error('unexpected call'))
      : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function authorizationOf(
  call: readonly [URL, (RequestInit | undefined)?] | undefined,
): string | null {
  return new Headers(call?.[1]?.headers).get('authorization');
}

const request = { path: '/player/state', schema: playerStateResponseSchema, baseUrl };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authorizedJson', () => {
  it('sends the access token as a Bearer header', async () => {
    const fetchMock = stubFetch(json(state));

    await expect(authorizedJson(tokens(), request)).resolves.toEqual(state);
    expect(authorizationOf(fetchMock.mock.calls[0])).toBe('Bearer token-1');
  });

  it('refreshes once and retries when the API rejects the token', async () => {
    const source = tokens();
    const fetchMock = stubFetch(unauthorized(), json(state));

    await expect(authorizedJson(source, request)).resolves.toEqual(state);
    expect(source.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(authorizationOf(fetchMock.mock.calls[1])).toBe('Bearer token-2');
    expect(source.expireSession).not.toHaveBeenCalled();
  });

  it('ends the session when it cannot be refreshed', async () => {
    const source = tokens({ refreshAccessToken: vi.fn(() => Promise.resolve(null)) });
    stubFetch(unauthorized());

    await expect(authorizedJson(source, request)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(source.expireSession).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the refreshed token is also rejected', async () => {
    const source = tokens();
    stubFetch(unauthorized(), unauthorized());

    await expect(authorizedJson(source, request)).rejects.toBeInstanceOf(ApiError);
    expect(source.expireSession).toHaveBeenCalledTimes(1);
  });

  it('does not call the API without a session', async () => {
    const fetchMock = stubFetch();

    await expect(
      authorizedJson(tokens({ getAccessToken: vi.fn(() => Promise.resolve(null)) }), request),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the session through a server error', async () => {
    const source = tokens();
    stubFetch(json({ statusCode: 503, code: 'AUTH_UNAVAILABLE', error: 'Try again' }, 503));

    await expect(authorizedJson(source, request)).rejects.toMatchObject({ status: 503 });
    expect(source.refreshAccessToken).not.toHaveBeenCalled();
    expect(source.expireSession).not.toHaveBeenCalled();
  });

  it("carries the API's error code and message for client errors", async () => {
    stubFetch(
      json({ statusCode: 404, code: 'PLAYER_NOT_PROVISIONED', error: 'No player exists.' }, 404),
    );

    await expect(authorizedJson(tokens(), request)).rejects.toMatchObject({
      status: 404,
      code: 'PLAYER_NOT_PROVISIONED',
      message: 'No player exists.',
    });
  });
});
