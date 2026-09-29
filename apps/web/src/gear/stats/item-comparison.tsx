'use client';

import type {
  CharacterStatIdDto,
  ItemInstanceDto,
  StatsPreviewResponse,
} from '@eternal-forge/contracts';
import { Alert, Button, Skeleton, cn } from '@eternal-forge/ui';
import { itemName, rarityPresentation, slotLabel } from '../gear-model';
import {
  STAT_LABEL,
  STAT_ORDER,
  deltaDirection,
  deltaTone,
  describeStatDelta,
  formatStat,
  formatStatDelta,
  isUnchanged,
} from './stat-format';

export interface ItemComparisonProps {
  /** `equip`: this item would go in; `unequip`: this worn item would come off. */
  readonly mode: 'equip' | 'unequip';
  readonly item: ItemInstanceDto;
  /**
   * What the page believes occupies the slot, shown while the server's answer
   * loads; the server's `change.replaces` takes over once it arrives.
   */
  readonly localReplaces: ItemInstanceDto | null;
  readonly preview: StatsPreviewResponse | undefined;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/**
 * Current → after, for one hypothetical equip or unequip, exactly as the
 * server resolved both loadouts (ADR-030). Only stats that change are shown
 * prominently; a change that caps or rounds away is shown as no change,
 * because that is what combat will see. Nothing is computed here.
 */
export function ItemComparison({
  mode,
  item,
  localReplaces,
  preview,
  loading,
  failed,
  onRetry,
}: ItemComparisonProps) {
  const replaces =
    preview?.change.kind === 'EQUIP'
      ? preview.change.replaces
      : preview === undefined
        ? localReplaces
        : null;
  return (
    <section className="comparison" aria-labelledby="comparison-heading" aria-busy={loading}>
      <h3 id="comparison-heading" className="comparison__heading">
        {mode === 'equip' ? 'If you equip this' : 'If you unequip this'}
      </h3>
      {mode === 'equip' ? <Replacement item={item} replaces={replaces} /> : null}

      {loading && !failed && preview === undefined ? (
        <div className="comparison__loading">
          <p className="sr-only" role="status">
            Comparing with your current gear…
          </p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {failed && preview === undefined ? (
        <div className="comparison__error">
          <Alert tone="warning">
            The comparison could not be loaded. Your stats are unchanged until you choose.
          </Alert>
          <Button variant="secondary" disabled={loading} onClick={onRetry}>
            {loading ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      ) : null}

      {preview === undefined ? null : (
        <ComparisonResult mode={mode} item={item} preview={preview} />
      )}
    </section>
  );
}

function Replacement({
  item,
  replaces,
}: {
  readonly item: ItemInstanceDto;
  readonly replaces: ItemInstanceDto | null;
}) {
  if (replaces === null) {
    return (
      <p className="comparison__replaces">
        Fills your empty <strong>{slotLabel(item.slot)}</strong> slot
      </p>
    );
  }
  return (
    <p className="comparison__replaces" data-testid="replaces">
      <span className="comparison__replaces-label">Replaces</span>{' '}
      <strong className={cn('comparison__replaced', rarityPresentation(replaces.rarity).className)}>
        {replaces.rarity} {itemName(replaces)}
      </strong>
    </p>
  );
}

function ComparisonResult({
  mode,
  item,
  preview,
}: {
  readonly mode: 'equip' | 'unequip';
  readonly item: ItemInstanceDto;
  readonly preview: StatsPreviewResponse;
}) {
  if (preview.unchanged) {
    return (
      <p className="comparison__none">
        {mode === 'equip' ? 'Already equipped.' : 'This slot is already empty.'}
      </p>
    );
  }
  const changed = STAT_ORDER.filter((stat) => !isUnchanged(preview.delta, stat));
  const unchanged = STAT_ORDER.filter((stat) => isUnchanged(preview.delta, stat));
  // A roll that pushes into a maximum shows as no change; say why.
  const touched = new Set<CharacterStatIdDto>(item.affixes.map((affix) => affix.stat));
  const capped = unchanged.filter(
    (stat) => touched.has(stat) && preview.preview.atMaximum.includes(stat),
  );

  return (
    <>
      {changed.length === 0 ? (
        <p className="comparison__none">No effective stat change</p>
      ) : (
        <ul className="comparison__rows" aria-label="Stat changes">
          {changed.map((stat) => {
            const tone = deltaTone(preview.delta, stat);
            return (
              <li key={stat} className={cn('comparison-row', `tone-${tone}`)} data-stat={stat}>
                <span className="sr-only">
                  {describeStatDelta(preview.delta, stat)}, from{' '}
                  {formatStat(preview.current.effective, stat)} to{' '}
                  {formatStat(preview.preview.effective, stat)}.
                </span>
                <span className="comparison-row__label" aria-hidden="true">
                  {STAT_LABEL[stat]}
                </span>
                <span className="comparison-row__values" aria-hidden="true">
                  <span className="comparison-row__current">
                    {formatStat(preview.current.effective, stat)}
                  </span>
                  <span className="comparison-row__arrow">→</span>
                  <span className="comparison-row__after">
                    {formatStat(preview.preview.effective, stat)}
                  </span>
                </span>
                <span className="comparison-row__delta" aria-hidden="true">
                  <span>{deltaDirection(preview.delta, stat) === 'up' ? '↑' : '↓'}</span>{' '}
                  {formatStatDelta(preview.delta, stat)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {capped.length === 0 ? null : (
        <p className="comparison__note">
          {capped.map((stat) => STAT_LABEL[stat]).join(' and ')}{' '}
          {capped.length === 1 ? 'is' : 'are'} already at the maximum — more has no effect.
        </p>
      )}
      {changed.length === 0 || unchanged.length === 0 ? null : (
        <p className="comparison__unchanged">
          Unchanged: {unchanged.map((stat) => STAT_LABEL[stat]).join(', ')}
        </p>
      )}
    </>
  );
}
