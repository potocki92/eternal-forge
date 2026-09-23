import type { CombatResponse } from '@eternal-forge/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { combatResponseFixture } from '@/test/fixtures';
import { CombatReport } from './combat-report';

/** A defeat on stage 10 that left the hero on `afterStage`. */
function defeat(afterStage: string): CombatResponse {
  const response = combatResponseFixture();
  return {
    ...response,
    combat: {
      ...response.combat,
      stage: { number: '10', kind: 'BOSS' },
      outcome: 'LOSS',
      endReason: 'PLAYER_DEFEATED',
      rewards: { gold: '0', experience: '0' },
    },
    after: {
      ...response.after,
      currentStage: afterStage,
      highestStageReached: '10',
      highestStageCleared: '9',
    },
  };
}

describe('CombatReport — where the hero goes after a defeat', () => {
  it('climbing: the server moved the hero back', () => {
    render(<CombatReport report={{ kind: 'finished', response: defeat('9'), next: undefined }} />);

    expect(screen.getByTestId('combat-status')).toHaveTextContent(
      'Defeat on stage 10. No rewards. Your hero falls back to stage 9.',
    );
  });

  it('farming: the server kept the hero on the stage (ADR-021)', () => {
    render(<CombatReport report={{ kind: 'finished', response: defeat('10'), next: undefined }} />);

    expect(screen.getByTestId('combat-status')).toHaveTextContent(
      'Defeat on stage 10. No rewards. Your hero stays on stage 10.',
    );
  });
});
