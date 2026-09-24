import type { HugeNumberDto, StageKind, StageNumberDto } from '@eternal-forge/contracts';
import { Button, ProgressBar, cn } from '@eternal-forge/ui';
import Link from 'next/link';
import { formatStage } from '@/player/format-stage';
import { formatHuge, hugeRatio } from '../format/format-huge';

export interface HudValues {
  readonly level: number;
  readonly experience: HugeNumberDto;
  readonly experienceToNextLevel: HugeNumberDto;
  readonly gold: HugeNumberDto;
  /** The stage the next combat is fought on. */
  readonly currentStage: StageNumberDto;
  /** The record the hero has set: `null` before the first victory (ADR-020). */
  readonly highestStageCleared: StageNumberDto | null;
  /** From the server's rule set; `undefined` when no enemy can be described. */
  readonly stageKind: StageKind | undefined;
}

export interface GameHudProps {
  readonly displayName: string;
  readonly heroName: string;
  readonly values: HudValues;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}

const levelFormat = new Intl.NumberFormat('en-US');

/**
 * Top of the game screen: who is playing, the hero's level and experience,
 * gold, the current stage and the best stage cleared. Values are exactly what
 * the server sent — during a combat,
 * the state *before* it, so the result is not revealed early.
 */
export function GameHud({ displayName, heroName, values, signingOut, onSignOut }: GameHudProps) {
  const isBoss = values.stageKind === 'BOSS';

  return (
    <header className="flex flex-col gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1
            className="truncate text-[0.6875rem] font-medium tracking-[0.2em] text-text-muted uppercase"
            data-testid="signed-in-as"
          >
            {displayName}
          </h1>
          <h2 className="truncate font-display text-xl leading-tight text-text-primary">
            {heroName}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/play/gear"
            className="rounded-(--radius-control) px-3 py-2 text-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            Gear
          </Link>
          <Button
            variant="ghost"
            size="sm"
            disabled={signingOut}
            onClick={onSignOut}
            className="-mr-2 shrink-0"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-text-muted">Level</dt>
          <dd className="font-mono text-base text-text-primary" data-testid="hud-level">
            {levelFormat.format(values.level)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="sr-only">Experience</dt>
          <dd>
            <ProgressBar
              label="Experience"
              tone="info"
              size="sm"
              value={hugeRatio(values.experience, values.experienceToNextLevel)}
              valueText={`${formatHuge(values.experience)} of ${formatHuge(values.experienceToNextLevel)} experience`}
            />
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5 justify-self-end">
          <dt className="text-xs text-text-muted">Gold</dt>
          <dd className="font-mono text-base text-rarity-legendary" data-testid="hud-gold">
            {formatHuge(values.gold)}
          </dd>
        </div>
        <div
          className={cn(
            'col-span-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-(--radius-control) px-3 py-1.5',
            isBoss ? 'bg-danger/15 ring-1 ring-danger/50' : 'bg-surface-elevated',
          )}
        >
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-text-muted">Stage</dt>
            <dd className="font-mono text-lg text-text-primary" data-testid="hud-stage">
              {formatStage(values.currentStage)}
            </dd>
          </div>
          <div className="ml-auto flex min-w-0 items-baseline gap-3">
            {isBoss ? (
              <span className="text-xs font-semibold tracking-[0.2em] text-danger uppercase">
                Boss stage
              </span>
            ) : null}
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-text-muted">
                Best<span className="sr-only"> stage cleared</span>
              </dt>
              <dd className="font-mono text-sm text-text-secondary" data-testid="hud-best-cleared">
                {values.highestStageCleared === null ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">none yet</span>
                  </>
                ) : (
                  formatStage(values.highestStageCleared)
                )}
              </dd>
            </div>
          </div>
        </div>
      </dl>
    </header>
  );
}
