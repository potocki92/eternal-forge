import { describe, expect, it, vi } from 'vitest';
import { ProbeTimeoutError, ReadinessService } from './readiness.service.js';
import type { Clock } from '../../common/clock/clock.port.js';
import type { DependencyProbe } from './ports/dependency-probe.port.js';

const VERSION = '1.2.3';

function fixedClock(startMs = 0, stepMs = 5): Clock {
  let current = startMs;
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
  };
}

function probe(name: string, behaviour: () => Promise<void>): DependencyProbe {
  return { name, check: behaviour };
}

describe('ReadinessService', () => {
  it('reports ok when every probe answers', async () => {
    const service = new ReadinessService(
      [probe('postgres', () => Promise.resolve()), probe('redis', () => Promise.resolve())],
      fixedClock(),
      VERSION,
    );

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.dependencies.map((dependency) => dependency.name)).toEqual(['postgres', 'redis']);
    expect(result.dependencies.every((dependency) => dependency.status === 'ok')).toBe(true);
  });

  it('reports down when a single probe fails, and names it', async () => {
    const service = new ReadinessService(
      [
        probe('postgres', () => Promise.resolve()),
        probe('redis', () => Promise.reject(new Error('connection refused'))),
      ],
      fixedClock(),
      VERSION,
    );

    const result = await service.check();

    expect(result.status).toBe('down');
    expect(result.dependencies.find((dependency) => dependency.name === 'redis')).toMatchObject({
      status: 'down',
      detail: 'unreachable',
    });
  });

  it('never leaks a driver error message to the caller', async () => {
    const leaky = new Error('could not connect to postgresql://forge:hunter2@db:5432/forge');
    const service = new ReadinessService(
      [probe('postgres', () => Promise.reject(leaky))],
      fixedClock(),
      VERSION,
    );

    const result = await service.check();

    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('times a hanging probe out instead of blocking the request', async () => {
    vi.useFakeTimers();

    try {
      const service = new ReadinessService(
        [probe('redis', () => new Promise<void>(() => undefined))],
        fixedClock(),
        VERSION,
      );

      const pending = service.check();
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await pending;

      expect(result.status).toBe('down');
      expect(result.dependencies[0]?.detail).toBe('timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs probes concurrently rather than in sequence', async () => {
    vi.useFakeTimers();

    try {
      const slow = (): Promise<void> =>
        new Promise((resolve) => {
          setTimeout(resolve, 500);
        });
      const service = new ReadinessService(
        [probe('a', slow), probe('b', slow), probe('c', slow)],
        fixedClock(),
        VERSION,
      );

      const pending = service.check();
      await vi.advanceTimersByTimeAsync(500);

      await expect(pending).resolves.toMatchObject({ status: 'ok' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ProbeTimeoutError', () => {
  it('names the probe that timed out', () => {
    expect(new ProbeTimeoutError('redis').message).toContain('redis');
  });
});
