'use client';

import type {
  CharacterStatIdDto,
  CharacterStatSourceDto,
  CharacterStatsResponse,
} from '@eternal-forge/contracts';
import { Alert, Button, Panel, Skeleton, cn } from '@eternal-forge/ui';
import { affixLabel, itemName, rarityPresentation, slotLabel } from '../gear-model';
import {
  STAT_LABEL,
  STAT_ORDER,
  deltaTone,
  formatStat,
  formatStatDelta,
  isUnchanged,
} from './stat-format';

export interface CharacterSheetProps {
  readonly heroName: string;
  readonly stats: CharacterStatsResponse | undefined;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/**
 * The build at a glance: the five stats the next online combat fights with,
 * exactly as the server resolved them (ADR-030). A collapsible breakdown
 * explains each one — level base, the net gear bonus, and the equipped rolls
 * that fed it — without crowding the loadout.
 */
export function CharacterSheet({
  heroName,
  stats,
  loading,
  refreshing,
  failed,
  onRetry,
}: CharacterSheetProps) {
  return (
    <Panel
      as="section"
      aria-labelledby="character-sheet-heading"
      aria-busy={loading || refreshing}
      className="character-sheet"
    >
      <header className="character-sheet__header">
        <div className="min-w-0">
          <p className="gear-eyebrow">Character</p>
          <h2 id="character-sheet-heading">{heroName}</h2>
        </div>
        {stats === undefined ? null : (
          <span className="character-sheet__level">Level {stats.level}</span>
        )}
      </header>

      {failed ? (
        <div className="character-sheet__error">
          {stats === undefined ? (
            <Alert tone="danger">Your stats could not be loaded.</Alert>
          ) : (
            // A failed refresh keeps the last answer: say so rather than let
            // old totals pass for the current build.
            <Alert tone="warning">
              Your stats could not be refreshed. These are the last values we received.
            </Alert>
          )}
          <Button variant="secondary" disabled={refreshing} onClick={onRetry}>
            {refreshing ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : null}

      {loading ? <StatGridSkeleton /> : null}

      {stats === undefined ? null : (
        <>
          <dl className="stat-grid" data-testid="stat-grid">
            {STAT_ORDER.map((stat) => (
              <div key={stat} className="stat-tile" data-stat={stat}>
                <dt>{STAT_LABEL[stat]}</dt>
                <dd>
                  <span className="stat-tile__value">
                    {formatStat(stats.stats.effective, stat)}
                  </span>
                  {stats.stats.atMaximum.includes(stat) ? (
                    <span className="stat-tile__cap">Max</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="sr-only" role="status">
            {refreshing ? 'Updating stats…' : ''}
          </p>
          <StatBreakdown stats={stats} />
        </>
      )}
    </Panel>
  );
}

function StatBreakdown({ stats }: { readonly stats: CharacterStatsResponse }) {
  const { base, bonus, effective, atMaximum } = stats.stats;
  return (
    <details className="stat-breakdown">
      <summary>Stat breakdown</summary>
      <p className="stat-breakdown__rule">
        Your level sets each base value. Flat gear bonuses are added first, then every percentage
        bonus multiplies that total once. Critical Chance tops out at 100% and Attack Speed at the
        combat limit.
      </p>
      <ul className="stat-breakdown__list">
        {STAT_ORDER.map((stat) => (
          <li key={stat} className="stat-breakdown__item" data-stat={stat}>
            <h3>
              {STAT_LABEL[stat]}
              {atMaximum.includes(stat) ? <span className="stat-tile__cap">Max</span> : null}
            </h3>
            <dl className="stat-breakdown__sum">
              <div>
                <dt>Base</dt>
                <dd>{formatStat(base, stat)}</dd>
              </div>
              <div>
                <dt>Gear</dt>
                <dd className={cn(`tone-${deltaTone(bonus, stat)}`)}>
                  {isUnchanged(bonus, stat) ? 'None' : formatStatDelta(bonus, stat)}
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{formatStat(effective, stat)}</dd>
              </div>
            </dl>
            <SourceList sources={stats.sources.filter((source) => source.stat === stat)} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function SourceList({ sources }: { readonly sources: readonly CharacterStatSourceDto[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="stat-breakdown__sources" aria-label="From equipped items">
      {sources.map((source, index) => (
        <li key={`${source.slot}-${String(index)}`}>
          <span
            className={cn('stat-source__item', rarityPresentation(source.itemRarity).className)}
          >
            {itemName({ nameKey: source.itemNameKey, definitionId: source.itemDefinitionId })}
            <span className="sr-only">, {slotLabel(source.slot)}</span>
          </span>
          <span className="stat-source__roll">{affixLabel(source)}</span>
        </li>
      ))}
    </ul>
  );
}

function StatGridSkeleton() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading stats…
      </p>
      <div className="stat-grid" aria-hidden="true">
        {STAT_ORDER.map((stat: CharacterStatIdDto) => (
          <Skeleton key={stat} className="h-14 w-full" />
        ))}
      </div>
    </>
  );
}
