import { describe, expect, it } from 'vitest';
import { combatResponseFixture } from '@/test/fixtures';
import { createPlayback, finalFrame, frameAt } from './combat-playback';

const combat = combatResponseFixture().combat;

describe('createPlayback', () => {
  const playback = createPlayback(combat);

  it('replays the server’s events in order, at their times', () => {
    expect(playback.hits.map((hit) => [hit.atMs, hit.attacker])).toEqual(
      combat.events.map((event) => [event.timeMs, event.attacker]),
    );
    expect(playback.durationMs).toBe(combat.durationMs);
  });

  it('tracks each side’s health from the server’s target health', () => {
    expect(playback.hits[0]).toMatchObject({ enemyHealth: '3e1', heroHealth: '1e2' });
    expect(playback.hits[1]).toMatchObject({ enemyHealth: '3e1', heroHealth: '9.6e1' });
    expect(playback.hits.at(-1)).toMatchObject({ enemyHealth: '0', lethal: true });
    expect(playback.hits.slice(0, -1).every((hit) => !hit.lethal)).toBe(true);
  });

  it('formats damage for display and keeps critical hits marked', () => {
    expect(playback.hits[2]).toMatchObject({ critical: true, damageLabel: '15' });
  });
});

describe('frameAt', () => {
  const playback = createPlayback(combat);

  it('starts at full health with nothing shown', () => {
    expect(frameAt(playback, 0)).toMatchObject({
      hitsShown: 0,
      lastHit: undefined,
      heroRatio: 1,
      enemyRatio: 1,
      finished: false,
    });
  });

  it('shows every hit landed so far', () => {
    const frame = frameAt(playback, 2_000);
    expect(frame.hitsShown).toBe(3);
    expect(frame.enemyRatio).toBeCloseTo(15 / 40);
    expect(frame.heroRatio).toBeCloseTo(96 / 100);
  });

  it('finishes at the combat’s duration', () => {
    expect(frameAt(playback, 3_999).finished).toBe(false);
    expect(finalFrame(playback)).toMatchObject({ finished: true, enemyRatio: 0, hitsShown: 7 });
  });

  it('keeps the timeline of a time-limit loss running to the limit', () => {
    const stalled = createPlayback({
      ...combat,
      outcome: 'LOSS',
      endReason: 'TIME_LIMIT',
      durationMs: 30_000,
      events: combat.events.slice(0, 2),
    });
    expect(frameAt(stalled, 5_000).finished).toBe(false);
    expect(finalFrame(stalled)).toMatchObject({ finished: true, hitsShown: 2 });
  });
});
