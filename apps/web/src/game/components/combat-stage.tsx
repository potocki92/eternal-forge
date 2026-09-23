import type { CombatOutcomeDto, EncounterDto, HugeNumberDto } from '@eternal-forge/contracts';
import { ProgressBar, cn } from '@eternal-forge/ui';
import type { RefObject } from 'react';
import { enemyName } from '../enemy-names';
import { formatHuge } from '../format/format-huge';
import type { SceneStatus } from '../scene/use-combat-scene';

export interface CombatantHealth {
  readonly current: HugeNumberDto;
  readonly max: HugeNumberDto;
  readonly ratio: number;
}

export interface CombatStageProps {
  readonly host: RefObject<HTMLDivElement | null>;
  readonly sceneStatus: SceneStatus;
  readonly encounter: EncounterDto | null;
  readonly heroName: string;
  readonly heroHealth: CombatantHealth;
  readonly enemyHealth: CombatantHealth | undefined;
  /** Shown over the scene when a combat has just ended. */
  readonly outcome: CombatOutcomeDto | undefined;
  /** A critical hit just landed: a short DOM flourish mirroring the scene. */
  readonly lastCritical: boolean;
}

/**
 * The battlefield: the PixiJS canvas and, over it, the DOM that carries every
 * piece of information the canvas shows — names, health, the boss marker and
 * the outcome (ADR-007). If the canvas cannot start, a static silhouette takes
 * its place and nothing is lost.
 */
export function CombatStage({
  host,
  sceneStatus,
  encounter,
  heroName,
  heroHealth,
  enemyHealth,
  outcome,
  lastCritical,
}: CombatStageProps) {
  const isBoss = encounter?.stage.kind === 'BOSS';
  const name = encounter === null ? undefined : enemyName(encounter.enemy.archetypeId);

  return (
    <section
      aria-label="Battlefield"
      className={cn(
        'relative isolate min-h-0 flex-1 overflow-hidden border-y border-border',
        'bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface-elevated),var(--color-background)_70%)]',
        isBoss &&
          'bg-[radial-gradient(ellipse_at_50%_30%,color-mix(in_oklch,var(--color-danger)_28%,var(--color-surface)),var(--color-background)_72%)]',
      )}
      data-testid="battlefield"
      data-stage-kind={encounter?.stage.kind ?? 'NONE'}
    >
      <div ref={host} className="absolute inset-0 -z-10" data-scene={sceneStatus} />

      {sceneStatus === 'unavailable' ? <StaticSilhouettes boss={isBoss} /> : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 p-4">
        {encounter === null || name === undefined ? (
          <p className="text-center text-sm text-text-secondary">
            Beyond this stage the known world ends. No enemy can be found.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <span data-testid="enemy-name">{name}</span>
                {isBoss ? (
                  <span
                    className="rounded-(--radius-pill) bg-danger px-2 py-0.5 text-[0.625rem] font-bold tracking-[0.2em] text-text-primary uppercase"
                    data-testid="boss-badge"
                  >
                    Boss
                  </span>
                ) : null}
              </p>
              {enemyHealth === undefined ? null : (
                <span className="font-mono text-xs text-text-secondary">
                  {formatHuge(enemyHealth.current)} / {formatHuge(enemyHealth.max)}
                </span>
              )}
            </div>
            {enemyHealth === undefined ? null : (
              <ProgressBar
                label={`${name} health`}
                tone="danger"
                size={isBoss ? 'lg' : 'md'}
                value={enemyHealth.ratio}
                valueText={`${formatHuge(enemyHealth.current)} of ${formatHuge(enemyHealth.max)}`}
              />
            )}
          </>
        )}
      </div>

      {outcome === undefined ? null : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p
            className={cn(
              'font-display text-4xl font-bold tracking-wide drop-shadow-[0_2px_8px_oklch(0%_0_0/80%)]',
              'motion-safe:animate-[ef-pop_var(--duration-slow)_var(--ease-emphasis)]',
              outcome === 'WIN' ? 'text-rarity-legendary' : 'text-danger',
            )}
            data-testid="outcome-banner"
          >
            {outcome === 'WIN' ? (isBoss ? 'Boss slain!' : 'Victory!') : 'Defeat'}
          </p>
        </div>
      )}

      {lastCritical ? (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm font-bold tracking-[0.3em] text-warning uppercase motion-safe:animate-[ef-pop_var(--duration-normal)_var(--ease-emphasis)]"
        >
          Critical
        </p>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-text-primary">{heroName}</p>
          <span className="font-mono text-xs text-text-secondary">
            {formatHuge(heroHealth.current)} / {formatHuge(heroHealth.max)}
          </span>
        </div>
        <ProgressBar
          label={`${heroName} health`}
          tone="success"
          value={heroHealth.ratio}
          valueText={`${formatHuge(heroHealth.current)} of ${formatHuge(heroHealth.max)}`}
        />
      </div>
    </section>
  );
}

/** A still, CSS-only stand-in for the scene when no renderer can start. */
function StaticSilhouettes({ boss }: { readonly boss: boolean }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      <div
        className={cn(
          'absolute top-[24%] left-1/2 -translate-x-1/2 rounded-full bg-surface-elevated ring-2 ring-border-strong',
          boss ? 'size-28 ring-danger' : 'size-20',
        )}
      />
      <div className="absolute bottom-[22%] left-1/2 h-20 w-12 -translate-x-1/2 rounded-(--radius-panel) bg-primary/70 ring-2 ring-border-strong" />
    </div>
  );
}
