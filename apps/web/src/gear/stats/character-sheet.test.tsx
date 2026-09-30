import type { CharacterStatsResponse } from '@eternal-forge/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { characterStatsFixture } from '@/test/fixtures';
import { CharacterSheet } from './character-sheet';

function powered(): CharacterStatsResponse {
  const fixture = characterStatsFixture();
  return {
    ...fixture,
    level: 24,
    stats: {
      base: { ...fixture.stats.base, damage: '1e2', maxHealth: '3.82e2' },
      bonus: {
        maxHealth: '0',
        damage: '4.3e1',
        attackSpeedBp: 2_700,
        criticalChanceBp: 9_500,
        criticalDamageBp: 1_800,
      },
      effective: {
        maxHealth: '3.82e2',
        damage: '1.43e2',
        attackSpeedBp: 12_700,
        criticalChanceBp: 10_000,
        criticalDamageBp: 16_800,
      },
      atMaximum: ['CRITICAL_CHANCE'],
    },
    sources: [
      {
        stat: 'DAMAGE',
        operation: 'FLAT',
        value: '1.8e1',
        slot: 'WEAPON',
        itemDefinitionId: 'forged_iron_sword',
        itemNameKey: 'item.forged_iron_sword.name',
        itemRarity: 'RARE',
      },
      {
        stat: 'DAMAGE',
        operation: 'ADDITIVE_PERCENT',
        value: '700',
        slot: 'RING',
        itemDefinitionId: 'runed_iron_ring',
        itemNameKey: 'item.runed_iron_ring.name',
        itemRarity: 'MAGIC',
      },
    ],
  };
}

function sheet(overrides: Partial<Parameters<typeof CharacterSheet>[0]> = {}) {
  const onRetry = vi.fn();
  render(
    <CharacterSheet
      heroName="Ember"
      stats={powered()}
      loading={false}
      refreshing={false}
      failed={false}
      onRetry={onRetry}
      {...overrides}
    />,
  );
  return { onRetry };
}

function tile(stat: string) {
  const element = document.querySelector<HTMLElement>(`.stat-tile[data-stat="${stat}"]`);
  if (element === null) throw new Error(`No tile for ${stat}`);
  return element;
}

describe('CharacterSheet', () => {
  it('shows the hero, the level and the five combat stats in player terms', () => {
    sheet();
    expect(screen.getByRole('heading', { name: 'Ember' })).toBeInTheDocument();
    expect(screen.getByText('Level 24')).toBeInTheDocument();
    const grid = screen.getByTestId('stat-grid');
    expect(
      within(grid)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Damage', 'Max Health', 'Attack Speed', 'Critical Chance', 'Critical Damage']);
    expect(tile('DAMAGE')).toHaveTextContent('143');
    expect(tile('MAX_HEALTH')).toHaveTextContent('382');
    expect(tile('ATTACK_SPEED')).toHaveTextContent('1.27 / sec');
    expect(tile('CRITICAL_DAMAGE')).toHaveTextContent('168.00%');
  });

  it('marks a stat at its maximum in text, not only colour', () => {
    sheet();
    expect(tile('CRITICAL_CHANCE')).toHaveTextContent('100.00%Max');
    expect(tile('DAMAGE')).not.toHaveTextContent('Max');
  });

  it('never shows armor, DPS or a power score', () => {
    sheet();
    expect(screen.queryByText(/armor|dps|power|score/iu)).toBeNull();
  });

  it('explains each stat as base, gear and total, with the rolls that fed it', () => {
    sheet();
    fireEvent.click(screen.getByText('Stat breakdown'));
    const damage = document.querySelector<HTMLElement>('.stat-breakdown__item[data-stat="DAMAGE"]');
    if (damage === null) throw new Error('No damage breakdown');
    expect(within(damage).getByText('Base').nextSibling).toHaveTextContent('100');
    expect(within(damage).getByText('Gear').nextSibling).toHaveTextContent('+43');
    expect(within(damage).getByText('Total').nextSibling).toHaveTextContent('143');
    const sources = within(damage).getByRole('list', { name: 'From equipped items' });
    expect(sources).toHaveTextContent('Forged Iron Sword');
    expect(sources).toHaveTextContent('+18 Damage');
    expect(sources).toHaveTextContent('Runed Iron Ring');
    expect(sources).toHaveTextContent('+7.00% Damage');

    const health = document.querySelector<HTMLElement>(
      '.stat-breakdown__item[data-stat="MAX_HEALTH"]',
    );
    expect(health).toHaveTextContent('None');
  });

  it('has an intentional loading state', () => {
    sheet({ stats: undefined, loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading stats…');
    expect(screen.queryByTestId('stat-grid')).toBeNull();
  });

  it('has a recoverable, stats-specific error state', () => {
    const { onRetry } = sheet({ stats: undefined, failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Your stats could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says when a refresh failed instead of passing old totals off as current', () => {
    const { onRetry } = sheet({ failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Your stats could not be refreshed.');
    expect(tile('DAMAGE')).toHaveTextContent('143');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the last known stats visible while they refresh', () => {
    sheet({ refreshing: true });
    expect(tile('DAMAGE')).toHaveTextContent('143');
    expect(screen.getByText('Updating stats…')).toBeInTheDocument();
  });
});
