import type { CombatResponse, EncounterDto } from '@eternal-forge/contracts';
import { Alert, cn } from '@eternal-forge/ui';
import type { ReactNode } from 'react';
import { formatStage } from '@/player/format-stage';
import type { CombatFailure } from '../combat-session';
import { enemyName } from '../enemy-names';
import { formatHuge } from '../format/format-huge';

export type ReportState =
  | { readonly kind: 'waiting'; readonly encounter: EncounterDto | null }
  | { readonly kind: 'requesting'; readonly encounter: EncounterDto | null }
  | { readonly kind: 'fighting'; readonly response: CombatResponse }
  | {
      readonly kind: 'finished';
      readonly response: CombatResponse;
      /** The enemy now waiting, once revealed. */
      readonly next: EncounterDto | null | undefined;
    }
  | { readonly kind: 'failed'; readonly failure: CombatFailure };

/**
 * The narration of the combat in text: what is waiting, what is happening and
 * what it earned. It is the accessible, canvas-independent record of every
 * state (ADR-007), announced politely as it changes, and the element
 * end-to-end tests read instead of pixels.
 */
export function CombatReport({ report }: { readonly report: ReportState }) {
  const phase = report.kind;
  const outcome =
    report.kind === 'fighting' || report.kind === 'finished'
      ? report.response.combat.outcome
      : undefined;

  return (
    <section
      aria-label="Combat report"
      className="flex min-h-24 flex-col justify-center gap-2 px-4 py-3"
      data-testid="combat-report"
      data-phase={phase}
      data-outcome={report.kind === 'finished' ? outcome : undefined}
    >
      {report.kind === 'failed' ? (
        <Alert tone="danger">{report.failure.message}</Alert>
      ) : (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-text-secondary"
          data-testid="combat-status"
        >
          {statusText(report)}
        </p>
      )}
      {report.kind === 'finished' ? (
        <Rewards response={report.response} next={report.next} />
      ) : null}
    </section>
  );
}

function statusText(report: Exclude<ReportState, { kind: 'failed' }>): string {
  switch (report.kind) {
    case 'waiting':
      return report.encounter === null
        ? 'No enemy can be found beyond this stage.'
        : `${describeEncounter(report.encounter)} awaits.`;
    case 'requesting':
      return 'Your hero charges in…';
    case 'fighting':
      return `Fighting ${describeEncounter(report.response.combat)}…`;
    case 'finished': {
      const { combat, after } = report.response;
      if (combat.outcome === 'WIN') {
        return `Victory! Stage ${formatStage(combat.stage.number)} cleared. +${formatHuge(combat.rewards.gold)} gold, +${formatHuge(combat.rewards.experience)} experience.`;
      }
      return `Defeat on stage ${formatStage(combat.stage.number)}. No rewards. Your hero falls back to stage ${formatStage(after.currentStage)}.`;
    }
  }
}

function describeEncounter(encounter: EncounterDto): string {
  const boss = encounter.stage.kind === 'BOSS' ? ' (boss)' : '';
  return `Stage ${formatStage(encounter.stage.number)}: ${enemyName(encounter.enemy.archetypeId)}${boss}`;
}

function Rewards({
  response,
  next,
}: {
  readonly response: CombatResponse;
  readonly next: EncounterDto | null | undefined;
}) {
  const { combat, after } = response;
  const won = combat.outcome === 'WIN';

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {won ? (
        <>
          <Chip tone="gold" testId="reward-gold">
            +{formatHuge(combat.rewards.gold)} gold
          </Chip>
          <Chip tone="experience" testId="reward-experience">
            +{formatHuge(combat.rewards.experience)} XP
          </Chip>
          {combat.levelsGained > 0 ? (
            <Chip tone="level" testId="level-up">
              Level up! {after.level}
            </Chip>
          ) : null}
        </>
      ) : (
        <Chip tone="muted">No rewards</Chip>
      )}
      {next === undefined ? null : (
        <span className="ml-auto text-xs text-text-muted" data-testid="next-encounter">
          {next === null ? 'The road ends here.' : `Next: ${describeEncounter(next)}`}
        </span>
      )}
    </div>
  );
}

function Chip({
  tone,
  testId,
  children,
}: {
  readonly tone: 'gold' | 'experience' | 'level' | 'muted';
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-(--radius-pill) px-2.5 py-1 font-mono text-xs font-semibold',
        'motion-safe:animate-[ef-pop_var(--duration-slow)_var(--ease-emphasis)]',
        tone === 'gold' && 'bg-rarity-legendary/15 text-rarity-legendary',
        tone === 'experience' && 'bg-info/15 text-info',
        tone === 'level' && 'bg-success/15 text-success',
        tone === 'muted' && 'bg-surface-elevated text-text-muted',
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
