import { afterEach, describe, expect, it, vi } from 'vitest';
import { livenessResponseSchema } from '@eternal-forge/contracts';
import { ApiError, fetchReadiness, getJson } from './api-client';

const baseUrl = 'http://api.test';

const liveness = {
  status: 'ok',
  service: 'eternal-forge-api',
  version: '0.0.0',
  uptimeSeconds: 1,
  serverTime: '2026-09-22T10:00:00.000Z',
};

function stubFetch(response: Response | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('returns the parsed payload', async () => {
    stubFetch(jsonResponse(liveness));

    await expect(getJson('/health', livenessResponseSchema, { baseUrl })).resolves.toEqual(
      liveness,
    );
  });

  it('rejects a payload that does not match the shared contract', async () => {
    stubFetch(jsonResponse({ status: 'ok' }));

    await expect(getJson('/health', livenessResponseSchema, { baseUrl })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('reports an unreachable service in plain language', async () => {
    stubFetch(new TypeError('Failed to fetch'));

    await expect(getJson('/health', livenessResponseSchema, { baseUrl })).rejects.toThrow(
      'The service could not be reached.',
    );
  });

  it('never surfaces the underlying transport message to the user', async () => {
    stubFetch(new TypeError('connect ECONNREFUSED 10.0.0.5:5432'));

    await expect(getJson('/health', livenessResponseSchema, { baseUrl })).rejects.not.toThrow(
      /ECONNREFUSED/u,
    );
  });

  it('treats an unexpected status as an error', async () => {
    stubFetch(jsonResponse({ message: 'nope' }, 500));

    await expect(getJson('/health', livenessResponseSchema, { baseUrl })).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('fetchReadiness', () => {
  it('accepts 503 because the body still reports which dependency failed', async () => {
    const body = {
      status: 'down',
      service: 'eternal-forge-api',
      version: '0.0.0',
      serverTime: '2026-09-22T10:00:00.000Z',
      dependencies: [{ name: 'redis', status: 'down', durationMs: 4, detail: 'unreachable' }],
    };
    stubFetch(jsonResponse(body, 503));

    await expect(fetchReadiness({ baseUrl })).resolves.toMatchObject({ status: 'down' });
  });
});
