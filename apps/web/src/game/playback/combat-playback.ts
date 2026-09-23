import type { CombatDto, HugeNumberDto } from '@eternal-forge/contracts';
import { formatHuge, hugeRatio } from '../format/format-huge';

/**
 * The presentation timeline of a combat the server resolved.
 *
 * Pure data derived from the response: which hit lands when, and each side's
 * health after it. Playback drives the DOM and the scene from it; nothing here
 * decides anything — the server's events are replayed in their order and at
 * their times, never recomputed.
 */
export interface PlaybackHit {
  readonly index: number;
  readonly atMs: number;
  readonly attacker: 'PLAYER' | 'ENEMY';
  readonly critical: boolean;
  readonly damageLabel: string;
  readonly heroHealth: HugeNumberDto;
  readonly enemyHealth: HugeNumberDto;
  readonly lethal: boolean;
}

export interface CombatPlayback {
  readonly combat: CombatDto;
  /** The simulated duration: the combat ends here, even after a quiet stretch. */
  readonly durationMs: number;
  readonly hits: readonly PlaybackHit[];
}

/** What is visible `elapsedMs` into the playback. */
export interface PlaybackFrame {
  readonly hitsShown: number;
  readonly lastHit: PlaybackHit | undefined;
  readonly heroHealth: HugeNumberDto;
  readonly enemyHealth: HugeNumberDto;
  readonly heroRatio: number;
  readonly enemyRatio: number;
  readonly finished: boolean;
}

export function createPlayback(combat: CombatDto): CombatPlayback {
  let heroHealth = combat.hero.maxHealth;
  let enemyHealth = combat.enemy.maxHealth;

  const hits = combat.events.map((event, index): PlaybackHit => {
    if (event.attacker === 'PLAYER') {
      enemyHealth = event.targetHealth;
    } else {
      heroHealth = event.targetHealth;
    }
    return {
      index,
      atMs: event.timeMs,
      attacker: event.attacker,
      critical: event.critical,
      damageLabel: formatHuge(event.damage),
      heroHealth,
      enemyHealth,
      lethal: event.targetHealth === '0',
    };
  });

  return { combat, durationMs: combat.durationMs, hits };
}

export function frameAt(playback: CombatPlayback, elapsedMs: number): PlaybackFrame {
  const hitsShown = playback.hits.filter((hit) => hit.atMs <= elapsedMs).length;
  const lastHit = hitsShown === 0 ? undefined : playback.hits[hitsShown - 1];
  const heroHealth = lastHit?.heroHealth ?? playback.combat.hero.maxHealth;
  const enemyHealth = lastHit?.enemyHealth ?? playback.combat.enemy.maxHealth;

  return {
    hitsShown,
    lastHit,
    heroHealth,
    enemyHealth,
    heroRatio: hugeRatio(heroHealth, playback.combat.hero.maxHealth),
    enemyRatio: hugeRatio(enemyHealth, playback.combat.enemy.maxHealth),
    finished: elapsedMs >= playback.durationMs,
  };
}

/** The final frame: what the player sees after the combat or after skipping it. */
export function finalFrame(playback: CombatPlayback): PlaybackFrame {
  return frameAt(playback, Math.max(playback.durationMs, playback.hits.at(-1)?.atMs ?? 0));
}
