import { describe, expect, it, vi } from 'vitest';
import { pingDatabase, type DatabaseProbeTarget } from './prisma-client.js';

function probeTarget(queryRaw: DatabaseProbeTarget['$queryRaw']): DatabaseProbeTarget {
  return { $queryRaw: queryRaw };
}

describe('pingDatabase', () => {
  it('issues a single trivial query', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ one: 1 }]);

    await pingDatabase(probeTarget(queryRaw));

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('propagates driver failures to the caller', async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error('connection refused'));

    await expect(pingDatabase(probeTarget(queryRaw))).rejects.toThrow('connection refused');
  });
});
