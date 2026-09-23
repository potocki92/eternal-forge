'use client';

import { useEffect, useState } from 'react';

/**
 * The current local time, refreshed at most every `intervalMs` until `until`
 * has passed, then no longer. Drives the "ready in 3s" countdown without a
 * timer running while nothing is waiting.
 */
export function useNow(until: number | undefined, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === undefined) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      const current = Date.now();
      setNow(current);
      if (current < until) {
        timer = setTimeout(tick, Math.min(intervalMs, until - current));
      }
    };
    timer = setTimeout(tick, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [until, intervalMs]);

  return now;
}
