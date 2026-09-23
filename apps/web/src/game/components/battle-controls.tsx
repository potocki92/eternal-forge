'use client';

import { Button, cn, type ButtonProps } from '@eternal-forge/ui';
import { useId } from 'react';
import type { AutoBattle } from '../auto-battle/use-auto-battle';
import { useNow } from '../use-now';

export interface FightControl {
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly variant: ButtonProps['variant'];
  readonly onFight: () => void;
}

export interface BattleControlsProps {
  readonly fight: FightControl;
  /** Present while a combat is playing: ends the animation, not the combat. */
  readonly onSkip: (() => void) | undefined;
  readonly auto: AutoBattle;
  /** Auto-battle cannot start (no enemy, signing out, session ended). */
  readonly autoUnavailable: boolean;
  /** Where the hero fights, as the server set it: "Climbing", "Farming stage 42". */
  readonly modeLabel: string;
}

/**
 * The bottom of the game screen: the one primary action, and online
 * auto-battle (ADR-022).
 *
 * Off: **Fight** and **Auto battle**. On: a single **Stop auto battle**, and a
 * status line saying what the loop is doing and when it asks for the next
 * fight. The countdown is the server's pacing gate as last reported, read on
 * the local clock only to choose when to ask; it is never a promise.
 */
export function BattleControls({
  fight,
  onSkip,
  auto,
  autoUnavailable,
  modeLabel,
}: BattleControlsProps) {
  const statusId = useId();
  const { status } = auto.state;
  const on = status === 'running' || status === 'stopping';
  const nextAt = status === 'running' && auto.step.kind === 'fight' ? auto.step.at : undefined;
  const now = useNow(nextAt);
  const seconds = nextAt === undefined ? 0 : Math.max(0, Math.ceil((nextAt - now) / 1_000));

  return (
    <footer className="flex flex-col gap-2 px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {status === 'off' ? null : (
        <p
          id={statusId}
          className={cn(
            'flex min-h-5 flex-wrap items-center gap-x-2 text-xs',
            status === 'halted' ? 'text-danger' : 'text-text-secondary',
          )}
          data-testid="auto-battle-status"
          data-auto-status={status}
          data-auto-step={
            status === 'running' ? (auto.step.kind === 'wait' ? auto.step.why : auto.step.kind) : ''
          }
        >
          {/* Announced when the loop's state changes, never every second. */}
          <span role="status" className="font-semibold">
            {headline(auto, modeLabel)}
          </span>
          {seconds > 0 && auto.step.kind === 'fight' ? (
            <span aria-hidden="true" data-testid="auto-battle-countdown">
              {auto.step.retry ? 'Retrying' : 'Next fight'} in {seconds}s
            </span>
          ) : null}
        </p>
      )}

      <div className="flex gap-2">
        {on ? (
          <Button
            size="lg"
            fullWidth
            variant="secondary"
            disabled={status === 'stopping'}
            aria-describedby={statusId}
            onClick={auto.stop}
            data-testid="auto-battle-stop"
          >
            {status === 'stopping' ? 'Stopping…' : 'Stop auto battle'}
          </Button>
        ) : (
          <Button
            size="lg"
            fullWidth
            variant={fight.variant}
            disabled={fight.disabled}
            aria-busy={fight.busy}
            onClick={fight.onFight}
            data-testid="fight-button"
          >
            {fight.label}
          </Button>
        )}
        {onSkip === undefined ? null : (
          <Button size="lg" variant="secondary" onClick={onSkip} data-testid="skip-button">
            Skip
          </Button>
        )}
        {on ? null : (
          <Button
            size="lg"
            variant="secondary"
            className="shrink-0 px-4"
            disabled={autoUnavailable}
            aria-describedby={status === 'halted' ? statusId : undefined}
            onClick={auto.start}
            data-testid="auto-battle-start"
          >
            Auto battle
          </Button>
        )}
      </div>
    </footer>
  );
}

function headline(auto: AutoBattle, modeLabel: string): string {
  const { state, step } = auto;
  switch (state.status) {
    case 'off':
      return '';
    case 'halted':
      return `Auto battle stopped. ${state.halt.message}`;
    case 'stopping':
      return 'Auto battle stops after this fight.';
    case 'running':
      if (step.kind === 'wait' && step.why === 'hidden') {
        return 'Auto battle paused while the game is hidden.';
      }
      if (step.kind === 'wait' && step.why === 'selection') {
        return 'Auto battle waits for your stage choice.';
      }
      return `Auto battle · ${modeLabel}`;
  }
}
