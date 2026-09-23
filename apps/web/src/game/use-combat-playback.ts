'use client';

import { useEffect, useRef, useState } from 'react';
import {
  finalFrame,
  frameAt,
  type CombatPlayback,
  type PlaybackFrame,
  type PlaybackHit,
} from './playback/combat-playback';

export interface PlaybackHandlers {
  readonly onHit: (hit: PlaybackHit) => void;
  readonly onEnd: () => void;
}

/**
 * Plays a resolved combat in real time: each server event at its own time,
 * then the end at the combat's duration — the same duration the server holds
 * the hero for, so the next fight unlocks as the animation ends.
 *
 * One timer at a time, scheduled for the next event; cleared on unmount or
 * when playback stops (a skip). Returns the frame to render: the live frame
 * while playing, the final frame once `playing` is false.
 */
export function useCombatPlayback(
  playback: CombatPlayback | undefined,
  playing: boolean,
  handlers: PlaybackHandlers,
): PlaybackFrame | undefined {
  // Keyed by playback, so a new combat never renders a frame of the old one's time.
  const [clock, setClock] = useState<{ playback: CombatPlayback; elapsed: number } | undefined>();
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (playback === undefined || !playing) {
      return;
    }
    const startedAt = Date.now();
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const step = (): void => {
      const now = Date.now() - startedAt;
      while (cursor < playback.hits.length && (playback.hits[cursor]?.atMs ?? 0) <= now) {
        const hit = playback.hits[cursor];
        cursor += 1;
        if (hit !== undefined) {
          latest.current.onHit(hit);
        }
      }
      setClock({ playback, elapsed: now });
      if (now >= playback.durationMs) {
        latest.current.onEnd();
        return;
      }
      const nextHit = playback.hits[cursor]?.atMs ?? Number.POSITIVE_INFINITY;
      timer = setTimeout(step, Math.max(0, Math.min(nextHit, playback.durationMs) - now));
    };

    timer = setTimeout(step, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [playback, playing]);

  if (playback === undefined) {
    return undefined;
  }
  if (!playing) {
    return finalFrame(playback);
  }
  return frameAt(playback, clock?.playback === playback ? clock.elapsed : 0);
}
