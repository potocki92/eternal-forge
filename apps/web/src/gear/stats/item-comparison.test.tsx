import type {
  CharacterStatDeltaDto,
  CharacterStatValuesDto,
  ItemInstanceDto,
  StatsPreviewResponse,
} from '@eternal-forge/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemComparison } from './item-comparison';

const current: CharacterStatValuesDto = {
  maxHealth: '3.82e2',
  damage: '1.43e2',
  attackSpeedBp: 12_700,
  criticalChanceBp: 1_440,
  criticalDamageBp: 16_800,
};
const zero: CharacterStatDeltaDto = {
  maxHealth: '0',
  damage: '0',
  attackSpeedBp: 0,
  criticalChanceBp: 0,
  criticalDamageBp: 0,
};

function item(
  id: string,
  rarity: ItemInstanceDto['rarity'],
  affixes: ItemInstanceDto['affixes'] = [],
): ItemInstanceDto {
  return {
    id,
    definitionId: 'forged_iron_sword',
    rarity,
    generationVersion: affixes.length === 0 ? 0 : 1,
    affixes,
    nameKey: 'item.forged_iron_sword.name',
    slot: 'WEAPON',
    createdAt: '2026-09-29T10:00:00.000Z',
  };
}

const candidate = item('11111111-1111-4111-8111-111111111111', 'RARE', [
  {
    id: '33333333-3333-4333-8333-333333333333',
    definitionId: 'critical_chance_flat',
    stat: 'CRITICAL_CHANCE',
    operation: 'FLAT',
    value: '400',
    position: 0,
  },
]);
const worn = item('22222222-2222-4222-8222-222222222222', 'MAGIC');

function preview(
  delta: CharacterStatDeltaDto,
  after: CharacterStatValuesDto,
  overrides: Partial<StatsPreviewResponse> = {},
): StatsPreviewResponse {
  const sheet = (effective: CharacterStatValuesDto) => ({
    base: current,
    bonus: zero,
    effective,
    atMaximum: [],
  });
  return {
    characterVersion: '4',
    rulesVersion: 3,
    change: { kind: 'EQUIP', slot: 'WEAPON', item: candidate, replaces: worn },
    unchanged: false,
    current: sheet(current),
    preview: sheet(after),
    delta,
    ...overrides,
  };
}

function show(overrides: Partial<Parameters<typeof ItemComparison>[0]> = {}) {
  const onRetry = vi.fn();
  render(
    <ItemComparison
      mode="equip"
      item={candidate}
      localReplaces={worn}
      preview={undefined}
      loading={false}
      failed={false}
      onRetry={onRetry}
      {...overrides}
    />,
  );
  return { onRetry };
}

const mixed = preview(
  { ...zero, damage: '1.8e1', maxHealth: '-3e1', criticalChanceBp: 370 },
  { ...current, damage: '1.61e2', maxHealth: '3.52e2', criticalChanceBp: 1_810 },
);

describe('ItemComparison', () => {
  it('shows current → after with signed, arrowed deltas for the stats that change', () => {
    show({ preview: mixed });
    const rows = within(screen.getByRole('list', { name: 'Stat changes' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.getAttribute('data-stat'))).toEqual([
      'DAMAGE',
      'MAX_HEALTH',
      'CRITICAL_CHANCE',
    ]);
    expect(rows[0]).toHaveTextContent('Damage143→161↑ +18');
    expect(rows[1]).toHaveTextContent('Max Health382→352↓ -30');
    expect(rows[2]).toHaveTextContent('14.40%→18.10%↑ +3.70%');
    expect(rows[0]).toHaveClass('tone-gain');
    expect(rows[1]).toHaveClass('tone-loss');
  });

  it('tells assistive technology what changes, not which colour it is', () => {
    show({ preview: mixed });
    expect(
      screen.getByText('Damage increases by 18, from 143 to 161.', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Max Health decreases by 30, from 382 to 352.', { exact: false }),
    ).toBeInTheDocument();
  });

  it('collapses unchanged stats into one quiet line', () => {
    show({ preview: mixed });
    expect(screen.getByText('Unchanged: Attack Speed, Critical Damage')).toBeInTheDocument();
  });

  it('names the item it replaces', () => {
    show({ preview: mixed });
    expect(screen.getByTestId('replaces')).toHaveTextContent('Replaces MAGIC Forged Iron Sword');
  });

  it('says when the candidate fills an empty slot', () => {
    show({
      localReplaces: null,
      preview: preview(zero, current, {
        change: { kind: 'EQUIP', slot: 'WEAPON', item: candidate, replaces: null },
      }),
    });
    expect(screen.getByText(/Fills your empty/u)).toHaveTextContent('Fills your empty Weapon slot');
  });

  it('shows a zero-power (Common or legacy) candidate as no effective change, not five +0 rows', () => {
    show({ item: item(candidate.id, 'COMMON'), preview: preview(zero, current) });
    expect(screen.getByText('No effective stat change')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stat changes' })).toBeNull();
    expect(screen.queryByText(/\+0/u)).toBeNull();
  });

  it('explains a zero change caused by a maximum instead of claiming a gain', () => {
    const capped = { ...current, criticalChanceBp: 10_000 };
    const response = preview(zero, capped);
    show({
      preview: {
        ...response,
        current: { ...response.current, effective: capped },
        preview: { ...response.preview, atMaximum: ['CRITICAL_CHANCE'] },
      },
    });
    expect(screen.getByText('No effective stat change')).toBeInTheDocument();
    expect(
      screen.getByText('Critical Chance is already at the maximum — more has no effect.'),
    ).toBeInTheDocument();
  });

  it('does not offer a comparison for an item that is already equipped', () => {
    show({ preview: preview(zero, current, { unchanged: true }) });
    expect(screen.getByText('Already equipped.')).toBeInTheDocument();
  });

  it('previews taking a worn item off', () => {
    show({
      mode: 'unequip',
      localReplaces: null,
      preview: preview(
        { ...zero, damage: '-1.8e1' },
        { ...current, damage: '1.25e2' },
        { change: { kind: 'UNEQUIP', slot: 'WEAPON', item: candidate } },
      ),
    });
    expect(screen.getByRole('heading', { name: 'If you unequip this' })).toBeInTheDocument();
    expect(screen.queryByTestId('replaces')).toBeNull();
    expect(screen.getByRole('listitem')).toHaveTextContent('143→125↓ -18');
  });

  it('keeps the item visible with a comparison skeleton while loading', () => {
    show({ loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Comparing with your current gear…');
    // What the page believes is in the slot is shown right away.
    expect(screen.getByTestId('replaces')).toHaveTextContent('MAGIC Forged Iron Sword');
  });

  it('reports a failed comparison without inventing zero deltas', () => {
    const { onRetry } = show({ failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('The comparison could not be loaded.');
    expect(screen.queryByText('No effective stat change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows a retry in progress once, not an error and a skeleton together', () => {
    show({ failed: true, loading: true });
    expect(screen.getByRole('button', { name: 'Trying again…' })).toBeDisabled();
    expect(screen.queryByText('Comparing with your current gear…')).toBeNull();
  });
});
