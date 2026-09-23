'use client';

import { Alert, Button, Panel } from '@eternal-forge/ui';
import { formatStage } from '@/player/format-stage';
import { formatHuge } from '../format/format-huge';
import type { OfflineClaim } from '../offline/use-offline-claim';
import { formatDuration } from '../offline/offline-claim';

const COUNT = new Intl.NumberFormat('en-US');

/**
 * What the hero did while the player was away (ADR-023) — a plain,
 * functional summary. Every value is the server's; nothing is computed here
 * but the formatting. The polished "welcome back" presentation is PR 4.4.
 *
 * It never covers the controls: the player can dismiss it, and a failed
 * claim offers a retry with the same key or an explicit "play without it".
 */
export function OfflineSummary({ claim }: { readonly claim: OfflineClaim }) {
  const { state } = claim;

  if (state.status === 'claiming') {
    return (
      <p
        role="status"
        className="px-4 py-2 text-xs text-text-secondary"
        data-testid="offline-claiming"
      >
        Checking what your hero did while you were away…
      </p>
    );
  }

  if (state.status === 'failed') {
    return (
      <Panel className="mx-4 my-2 flex flex-col gap-3" data-testid="offline-failed">
        <Alert tone="danger">{state.failure.message}</Alert>
        <div className="flex gap-2">
          {state.failure.retryable ? (
            <Button size="sm" onClick={claim.retry} data-testid="offline-retry">
              Try again
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={claim.dismiss}>
            Play without it
          </Button>
        </div>
      </Panel>
    );
  }

  if (state.status !== 'shown') {
    return null;
  }

  const { summary } = state;
  const rows: readonly (readonly [string, string, string])[] = [
    ['Away', formatDuration(summary.elapsedMs), 'offline-away'],
    [
      'Counted',
      `${formatDuration(summary.rewardedMs)}${summary.capReached ? ' (limit reached)' : ''}`,
      'offline-counted',
    ],
    [
      'Stage farmed',
      summary.targetStage === null ? '—' : formatStage(summary.targetStage.number),
      'offline-stage',
    ],
    [
      'Battles',
      `${COUNT.format(summary.fights)} (${COUNT.format(summary.wins)} won)`,
      'offline-battles',
    ],
    ['Gold', `+${formatHuge(summary.rewards.gold)}`, 'offline-gold'],
    ['XP', `+${formatHuge(summary.rewards.experience)}`, 'offline-xp'],
  ];

  return (
    <Panel
      className="mx-4 my-2 flex flex-col gap-2"
      aria-labelledby="offline-summary-title"
      data-testid="offline-summary"
    >
      <h2 id="offline-summary-title" className="text-sm font-semibold text-text-primary">
        Offline progress
      </h2>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value, testId]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd
              className="text-right font-medium text-text-primary tabular-nums"
              data-testid={testId}
            >
              {value}
            </dd>
          </div>
        ))}
        {summary.levelsGained > 0 ? (
          <div className="contents">
            <dt className="text-text-muted">Levels</dt>
            <dd className="text-right font-medium text-text-primary" data-testid="offline-levels">
              +{summary.levelsGained}
            </dd>
          </div>
        ) : null}
      </dl>
      <Button size="sm" onClick={claim.dismiss} data-testid="offline-continue">
        Continue
      </Button>
    </Panel>
  );
}
