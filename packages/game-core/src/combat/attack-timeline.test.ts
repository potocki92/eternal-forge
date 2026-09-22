import { describe, expect, it } from 'vitest';
import { attackTimeMs, landsNoLaterThan, landsWithin } from './attack-timeline.js';

describe('attack timeline', () => {
  it('orders attacks exactly, including ties', () => {
    // 1/s vs 0.8/s: the 4th player attack (4 s) precedes the 4th enemy attack (5 s).
    expect(landsNoLaterThan(4, 10_000, 4, 8_000)).toBe(true);
    expect(landsNoLaterThan(4, 8_000, 3, 10_000)).toBe(false);
    // 3/s vs 1/s: the 3rd attack at exactly 1 s ties the 1st.
    expect(landsNoLaterThan(3, 30_000, 1, 10_000)).toBe(true);
    expect(landsNoLaterThan(1, 10_000, 3, 30_000)).toBe(true);
  });

  it('includes an attack landing exactly on the limit', () => {
    expect(landsWithin(30, 10_000, 30_000)).toBe(true);
    expect(landsWithin(31, 10_000, 30_000)).toBe(false);
    expect(landsWithin(1, 1, 30_000)).toBe(false); // one attack per 10 000 s
  });

  it('floors landing times to whole milliseconds with integer arithmetic', () => {
    expect(attackTimeMs(1, 30_000)).toBe(333);
    expect(attackTimeMs(2, 30_000)).toBe(666);
    expect(attackTimeMs(3, 30_000)).toBe(1000);
    expect(attackTimeMs(1, 7_000)).toBe(1428);
    expect(attackTimeMs(300, 100_000)).toBe(30_000);
  });
});
