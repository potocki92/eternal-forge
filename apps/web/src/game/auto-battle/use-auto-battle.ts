'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { CombatSession } from '../use-combat-session';
import { usePageVisible } from '../use-page-visible';
import {
  AUTO_BATTLE_OFF,
  autoBattleReducer,
  nextAutoBattleStep,
  type AutoBattleState,
  type AutoBattleStep,
  type AutoBattleView,
} from './auto-battle';

export interface AutoBattle {
  readonly state: AutoBattleState;
  /** What the loop is doing now: waiting on something, or the next fight's time. */
  readonly step: AutoBattleStep;
  readonly start: () => void;
  readonly stop: () => void;
}

export type AutoBattleScreen = Omit<AutoBattleView, 'session' | 'visible'>;

/**
 * Runs online auto-battle on top of the combat session (ADR-022).
 *
 * The loop sends fights through `session.fight` — the same function, the same
 * request, the same idempotency and retry rules as the Fight button — and only
 * decides *when*: `nextAutoBattleStep` names the moment, one timer waits for
 * it. At most one timer exists, it is replaced whenever the screen changes and
 * cleared on unmount, and `fight` itself ignores a call while a combat is
 * requested or playing, so the loop can never overlap two requests.
 *
 * `active` is false while the player signs out: the loop stops at once. The
 * screen is keyed by user, so a new account never inherits a running loop,
 * and a reload always starts with auto-battle off.
 */
export function useAutoBattle(
  session: CombatSession,
  screen: AutoBattleScreen,
  active: boolean,
): AutoBattle {
  const [state, dispatch] = useReducer(autoBattleReducer, AUTO_BATTLE_OFF);
  const visible = usePageVisible();
  const phase = session.state.phase;

  // Every answer to a request, seen once: the session state object changes
  // exactly when a request resolves or fails.
  useEffect(() => {
    if (session.state.phase === 'fighting') {
      dispatch({ type: 'resolved' });
    } else if (session.state.phase === 'failed') {
      dispatch({ type: 'failed', failure: session.state.failure });
    }
  }, [session.state]);

  const step = nextAutoBattleStep(state, { ...screen, session: session.state, visible });

  // Only a running loop can be halted, so this dispatches once and the next
  // render's step is no longer a halt.
  const halt = step.kind === 'halt' ? step.halt : undefined;
  useEffect(() => {
    if (halt !== undefined) {
      dispatch({ type: 'halt', halt });
    }
  }, [halt]);

  const fight = useRef(session.fight);
  useEffect(() => {
    fight.current = session.fight;
  });

  const fightAt = step.kind === 'fight' ? step.at : undefined;
  useEffect(() => {
    if (fightAt === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        fight.current();
      },
      Math.max(0, fightAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [fightAt]);

  useEffect(() => {
    if (!active) {
      dispatch({ type: 'stop', inFlight: false });
    }
  }, [active]);

  const start = useCallback(() => {
    dispatch({ type: 'start' });
  }, []);
  const stop = useCallback(() => {
    dispatch({ type: 'stop', inFlight: phase === 'requesting' });
  }, [phase]);

  return { state, step, start, stop };
}
