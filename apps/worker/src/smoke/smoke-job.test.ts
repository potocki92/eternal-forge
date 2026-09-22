import { describe, expect, it } from 'vitest';
import { handleSmokeJob, smokeJobDataSchema } from './smoke-job.js';

describe('handleSmokeJob', () => {
  it('answers a well formed job and reports queue latency', () => {
    const result = handleSmokeJob({ requestId: 'abc', enqueuedAt: 1_000 }, 1_250);

    expect(result).toEqual({ requestId: 'abc', pong: true, latencyMs: 250 });
  });

  it('clamps latency when the enqueuing clock ran ahead of this process', () => {
    expect(handleSmokeJob({ requestId: 'abc', enqueuedAt: 5_000 }, 1_000).latencyMs).toBe(0);
  });

  it('rejects a payload that does not match the contract', () => {
    expect(() => handleSmokeJob({ requestId: '' }, 0)).toThrow();
    expect(() => handleSmokeJob({ requestId: 'abc', enqueuedAt: -1 }, 0)).toThrow();
    expect(() => handleSmokeJob(null, 0)).toThrow();
  });
});

describe('smokeJobDataSchema', () => {
  it('rejects a non-integer timestamp', () => {
    expect(smokeJobDataSchema.safeParse({ requestId: 'a', enqueuedAt: 1.5 }).success).toBe(false);
  });
});
