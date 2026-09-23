import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineProgressFixture } from '@/test/fixtures';
import type { OfflineClaim } from '../offline/use-offline-claim';
import { OfflineSummary } from './offline-summary';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

function shown(overrides: Partial<ReturnType<typeof offlineProgressFixture>['offline']> = {}) {
  const response = offlineProgressFixture('collected');
  const claim: OfflineClaim = {
    state: { status: 'shown', summary: { ...response.offline, ...overrides } },
    retry: vi.fn(),
    dismiss: vi.fn(),
  };
  return claim;
}

describe('OfflineSummary', () => {
  it('gives a meaningful result a focused, accessible welcome-back dialog', () => {
    const claim = shown();
    render(<OfflineSummary claim={claim} currentLevel={4} heroName="Ember" />);

    expect(screen.getByRole('dialog', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(screen.getByTestId('offline-away')).toHaveTextContent('3h 42m');
    expect(screen.getByTestId('offline-gold')).toHaveTextContent('+120');
    expect(screen.getByTestId('offline-xp')).toHaveTextContent('+72');
    expect(screen.getByTestId('offline-battles')).toHaveTextContent('24');
    expect(screen.getByTestId('offline-victories')).toHaveTextContent('24');
    expect(screen.getByTestId('offline-stage')).toHaveTextContent('1');
    expect(screen.getByTestId('offline-current-state')).toHaveTextContent(
      'Ember returns at level 4',
    );
    expect(screen.getByTestId('offline-continue')).toHaveFocus();

    fireEvent.click(screen.getByTestId('offline-continue'));
    expect(claim.dismiss).toHaveBeenCalledOnce();
  });

  it('shows single and multiple authoritative level gains', () => {
    const { rerender } = render(
      <OfflineSummary claim={shown({ levelsGained: 1 })} currentLevel={19} heroName="Ember" />,
    );
    expect(screen.getByTestId('offline-levels')).toHaveTextContent(/18.*19/u);
    expect(screen.getByTestId('offline-levels')).not.toHaveTextContent('+1 levels');

    rerender(
      <OfflineSummary claim={shown({ levelsGained: 5 })} currentLevel={23} heroName="Ember" />,
    );
    expect(screen.getByTestId('offline-levels')).toHaveTextContent(/18.*23/u);
    expect(screen.getByTestId('offline-levels')).toHaveTextContent('+5 levels');
  });

  it('shows the cap quietly only when reached', () => {
    const claim = shown({ capReached: false });
    const { rerender } = render(<OfflineSummary claim={claim} currentLevel={4} heroName="Ember" />);
    expect(screen.queryByTestId('offline-cap-notice')).not.toBeInTheDocument();

    rerender(
      <OfflineSummary
        claim={shown({ capReached: true, rewardedMs: 28_800_000 })}
        currentLevel={4}
        heroName="Ember"
      />,
    );
    expect(screen.getByTestId('offline-cap-notice')).toHaveTextContent('Offline limit reached');
    expect(screen.getByTestId('offline-counted')).toHaveTextContent('8h of progress collected');
  });

  it('formats HugeNumber and StageNumber values without precision loss', () => {
    render(
      <OfflineSummary
        claim={shown({
          rewards: { gold: '1.23456789012345678e80', experience: '9.87654321098765432e70' },
          targetStage: { number: '9007199254740993123456789', kind: 'REGULAR' },
        })}
        currentLevel={4}
        heroName="Ember"
      />,
    );
    expect(screen.getByTestId('offline-gold')).toHaveTextContent('+1.23e80');
    expect(screen.getByTestId('offline-xp')).toHaveTextContent('+9.87e70');
    expect(screen.getByTestId('offline-stage')).toHaveTextContent(
      '9,007,199,254,740,993,123,456,789',
    );
  });

  it('renders no large summary for a settled no-op', () => {
    const claim: OfflineClaim = {
      state: { status: 'settled' },
      retry: vi.fn(),
      dismiss: vi.fn(),
    };
    const { container } = render(
      <OfflineSummary claim={claim} currentLevel={1} heroName="Ember" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes reduced-motion state and renders the complete result immediately', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<OfflineSummary claim={shown()} currentLevel={4} heroName="Ember" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-reduced-motion', 'true');
    expect(screen.getByTestId('offline-gold')).toBeVisible();
    expect(screen.getByTestId('offline-battles')).toBeVisible();
  });

  it('offers a safe retry and a way into the game after a temporary failure', () => {
    const claim: OfflineClaim = {
      state: {
        status: 'failed',
        key: 'same-key',
        failure: { message: 'The forge cannot be reached.', retryable: true },
      },
      retry: vi.fn(),
      dismiss: vi.fn(),
    };
    render(<OfflineSummary claim={claim} currentLevel={1} heroName="Ember" />);
    expect(screen.getByRole('dialog', { name: 'The forge is waiting' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(claim.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Play without it' }));
    expect(claim.dismiss).toHaveBeenCalledOnce();
  });
});
