import { describe, expect, it } from 'vitest';
import { LivenessService } from './liveness.service.js';
import type { Clock } from '../../common/clock/clock.port.js';

describe('LivenessService', () => {
  it('reports uptime measured from process start', () => {
    const times = [new Date(1_000), new Date(4_500)];
    let index = 0;
    const clock: Clock = {
      now: () => times[Math.min(index++, times.length - 1)] ?? new Date(0),
    };

    const result = new LivenessService(clock, '1.2.3').check();

    expect(result.status).toBe('ok');
    expect(result.version).toBe('1.2.3');
    expect(result.uptimeSeconds).toBeCloseTo(3.5);
    expect(result.serverTime).toBe(new Date(4_500).toISOString());
  });
});
