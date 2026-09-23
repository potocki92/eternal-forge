'use client';

import { Alert, Button } from '@eternal-forge/ui';
import { useEffect, useId, useRef } from 'react';
import { formatStage } from '@/player/format-stage';
import { formatHuge } from '../format/format-huge';
import type { OfflineClaim } from '../offline/use-offline-claim';
import { formatDuration } from '../offline/offline-claim';
import { usePrefersReducedMotion } from '../use-reduced-motion';

const COUNT = new Intl.NumberFormat('en-US');

interface OfflineSummaryProps {
  readonly claim: OfflineClaim;
  readonly currentLevel: number;
  readonly heroName: string;
}

/** Presents the authoritative offline result. Dismissing it never performs a mutation. */
export function OfflineSummary({ claim, currentLevel, heroName }: OfflineSummaryProps) {
  const { state } = claim;

  if (state.status === 'claiming') {
    return (
      <p
        role="status"
        className="px-4 py-2 text-center text-xs text-text-secondary"
        data-testid="offline-claiming"
      >
        Checking what your hero did while you were away…
      </p>
    );
  }

  if (state.status === 'failed') {
    return (
      <OfflineDialog title="The forge is waiting" initialFocus="primary">
        <div className="flex flex-col gap-5" data-testid="offline-failed">
          <Alert tone="danger">{state.failure.message}</Alert>
          <p className="text-sm leading-relaxed text-text-secondary">
            You can try again safely, or enter the game and return to your earnings later.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={claim.dismiss}>
              Play without it
            </Button>
            {state.failure.retryable ? (
              <Button onClick={claim.retry} data-testid="offline-retry" data-dialog-primary>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </OfflineDialog>
    );
  }

  if (state.status !== 'shown') {
    return null;
  }

  const { summary } = state;
  const previousLevel = Math.max(1, currentLevel - summary.levelsGained);

  return (
    <OfflineDialog title="Welcome Back" initialFocus="primary">
      <div className="welcome-back" data-testid="offline-summary">
        <header className="welcome-back__header">
          <p className="welcome-back__eyebrow">The forge burned on</p>
          <h2 id="offline-summary-title" className="welcome-back__title">
            Welcome Back
          </h2>
          <p className="welcome-back__away">
            Away for <strong data-testid="offline-away">{formatDuration(summary.elapsedMs)}</strong>
          </p>
        </header>

        <section aria-labelledby="offline-rewards-title" className="welcome-back__reveal">
          <h3 id="offline-rewards-title" className="welcome-back__section-title">
            Rewards gathered
          </h3>
          <dl className="welcome-back__rewards">
            <Reward
              label="Gold"
              value={`+${formatHuge(summary.rewards.gold)}`}
              testId="offline-gold"
            />
            <Reward
              label="Experience"
              value={`+${formatHuge(summary.rewards.experience)}`}
              testId="offline-xp"
            />
          </dl>
        </section>

        {summary.levelsGained > 0 ? (
          <section
            aria-label={`${String(summary.levelsGained)} levels gained`}
            className="welcome-back__level welcome-back__reveal"
            data-testid="offline-levels"
          >
            <span className="welcome-back__level-label">Level up</span>
            <strong>
              {previousLevel} <span aria-hidden="true">→</span> <span className="sr-only">to </span>
              {currentLevel}
            </strong>
            {summary.levelsGained > 1 ? <span>+{summary.levelsGained} levels</span> : null}
          </section>
        ) : null}

        <section aria-labelledby="offline-battles-title" className="welcome-back__reveal">
          <h3 id="offline-battles-title" className="welcome-back__section-title">
            While you were away
          </h3>
          <dl className="welcome-back__stats">
            <Stat label="Battles" value={COUNT.format(summary.fights)} testId="offline-battles" />
            <Stat label="Victories" value={COUNT.format(summary.wins)} testId="offline-victories" />
            {summary.losses > 0 ? (
              <Stat label="Defeats" value={COUNT.format(summary.losses)} testId="offline-losses" />
            ) : null}
            <Stat
              label="Stage farmed"
              value={summary.targetStage === null ? '—' : formatStage(summary.targetStage.number)}
              testId="offline-stage"
            />
          </dl>
        </section>

        {summary.capReached ? (
          <aside className="welcome-back__cap" data-testid="offline-cap-notice">
            <strong>Offline limit reached</strong>
            <span data-testid="offline-counted">
              {formatDuration(summary.rewardedMs)} of progress collected
            </span>
          </aside>
        ) : null}

        <p className="welcome-back__current" data-testid="offline-current-state">
          {heroName} returns at level {currentLevel}.
        </p>
        <Button
          size="lg"
          className="w-full"
          onClick={claim.dismiss}
          data-testid="offline-continue"
          data-dialog-primary
        >
          Continue
        </Button>
      </div>
    </OfflineDialog>
  );
}

function Reward({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="welcome-back__reward">
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

/** A blocking, focus-contained dialog. Escape is intentionally disabled: choose an explicit action. */
function OfflineDialog({
  title,
  children,
}: {
  readonly title: string;
  readonly initialFocus: 'primary';
  readonly children: React.ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const primary = dialog.current?.querySelector<HTMLElement>('[data-dialog-primary]');
    primary?.focus();
  }, []);

  return (
    <div className="welcome-back-layer">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="welcome-back-dialog"
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
          }
          if (event.key === 'Tab') {
            const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
            if (controls === undefined || controls.length === 0) {
              event.preventDefault();
              return;
            }
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (
              controls.length === 1 ||
              (event.shiftKey && document.activeElement === first) ||
              (!event.shiftKey && document.activeElement === last)
            ) {
              event.preventDefault();
              (event.shiftKey ? last : first)?.focus();
            }
          }
        }}
      >
        <span id={titleId} className="sr-only">
          {title}
        </span>
        {children}
      </div>
    </div>
  );
}
