import { describe, expect, it } from 'vitest';
import { livenessResponseSchema, readinessResponseSchema } from './health.contract.js';

const serverTime = '2026-09-22T10:00:00.000Z';

describe('livenessResponseSchema', () => {
  it('accepts a well formed payload', () => {
    const payload = {
      status: 'ok',
      service: 'eternal-forge-api',
      version: '0.0.0',
      uptimeSeconds: 12.5,
      serverTime,
    };

    expect(livenessResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a negative uptime', () => {
    const result = livenessResponseSchema.safeParse({
      status: 'ok',
      service: 'eternal-forge-api',
      version: '0.0.0',
      uptimeSeconds: -1,
      serverTime,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non ISO-8601 server time', () => {
    const result = livenessResponseSchema.safeParse({
      status: 'ok',
      service: 'eternal-forge-api',
      version: '0.0.0',
      uptimeSeconds: 1,
      serverTime: '22/09/2026',
    });

    expect(result.success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  it('accepts a degraded payload carrying dependency detail', () => {
    const payload = {
      status: 'degraded',
      service: 'eternal-forge-api',
      version: '0.0.0',
      serverTime,
      dependencies: [
        { name: 'postgres', status: 'ok', durationMs: 3 },
        { name: 'redis', status: 'down', durationMs: 51, detail: 'connection refused' },
      ],
    };

    expect(readinessResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unknown status', () => {
    expect(
      readinessResponseSchema.safeParse({
        status: 'weird',
        service: 'a',
        version: '0.0.0',
        serverTime,
        dependencies: [],
      }).success,
    ).toBe(false);
  });
});
