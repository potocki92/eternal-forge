'use client';

import type { EncounterDto, PlayerStateResponse } from '@eternal-forge/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatStage } from '@/player/format-stage';
import { useAutoBattle } from '../auto-battle/use-auto-battle';
import { localReadyAt } from '../combat-session';
import { hugeRatio } from '../format/format-huge';
import { createPlayback } from '../playback/combat-playback';
import type { CombatSceneFactory } from '../scene/combat-scene';
import { loadPixiCombatScene } from '../scene/load-pixi-combat-scene';
import { useCombatScene } from '../scene/use-combat-scene';
import { useCombatPlayback } from '../use-combat-playback';
import { useCombatSession } from '../use-combat-session';
import { useStageSelection } from '../stage-selection/use-stage-selection';
import { blocksFighting } from '../offline/offline-claim';
import { useOfflineClaim } from '../offline/use-offline-claim';
import { useNow } from '../use-now';
import { usePrefersReducedMotion } from '../use-reduced-motion';
import { BattleControls } from './battle-controls';
import { CombatReport, type ReportState } from './combat-report';
import { CombatStage, type CombatantHealth } from './combat-stage';
import { GameHud, type HudValues } from './game-hud';
import { OfflineSummary } from './offline-summary';
import { StageSelector } from './stage-selector';

/** How long a finished combat stays on screen before the next enemy steps in. */
const REVEAL_DELAY_MS = 1_200;

export interface GameScreenProps {
  readonly userId: string;
  readonly player: PlayerStateResponse;
  /** Local epoch ms the player state arrived, anchoring its server times. */
  readonly receivedAt: number;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
  /** The combat renderer. Tests inject a fake; production loads PixiJS lazily. */
  readonly sceneFactory?: CombatSceneFactory;
}

/**
 * The first game screen (Phase 3), mobile first at 390×844.
 *
 * It renders a gameplay loop it does not run: the server resolves each combat
 * (ADR-019), this screen shows it. Online auto-battle (ADR-022) only presses
 * the same Fight for the player, when the server's pacing gate allows. React
 * owns the layout, the controls and every piece of information; the PixiJS
 * scene only animates the cues it is given (ADR-007).
 */
export function GameScreen({
  userId,
  player,
  receivedAt,
  signingOut,
  onSignOut,
  sceneFactory = loadPixiCombatScene,
}: GameScreenProps) {
  const reducedMotion = usePrefersReducedMotion();
  const session = useCombatSession(userId, player.character.id);
  const { state, fight, finish } = session;
  const stageSelection = useStageSelection(userId, player.character.id);
  // Offline progress (ADR-023) is asked for before any fight on entering the
  // game and after the page was hidden: an online fight ends the idle time.
  const offlineClaim = useOfflineClaim(userId, player.character.id, !signingOut);
  const offlinePending = blocksFighting(offlineClaim.state);
  const response =
    state.phase === 'fighting' || state.phase === 'finished' ? state.response : undefined;

  const host = useRef<HTMLDivElement>(null);
  const { status: sceneStatus, scene } = useCombatScene(host, sceneFactory, reducedMotion);

  // --- Playback -------------------------------------------------------------
  const playback = useMemo(
    () => (response === undefined ? undefined : createPlayback(response.combat)),
    [response],
  );
  const [lastCritical, setLastCritical] = useState(false);

  const end = useCallback(() => {
    if (response !== undefined) {
      scene.current?.showOutcome(response.combat.outcome);
    }
    setLastCritical(false);
    finish();
  }, [finish, response, scene]);

  const frame = useCombatPlayback(playback, state.phase === 'fighting', {
    onHit: (hit) => {
      scene.current?.playHit({
        attacker: hit.attacker,
        critical: hit.critical,
        damageLabel: hit.damageLabel,
        lethal: hit.lethal,
      });
      setLastCritical(hit.critical);
    },
    onEnd: end,
  });

  // --- The next enemy steps in a moment after the result -------------------
  const [reveal, setReveal] = useState<{ readonly combatId: string; readonly count: number }>({
    combatId: '',
    count: 0,
  });
  const finishedId = state.phase === 'finished' ? state.response.combat.id : undefined;
  useEffect(() => {
    if (finishedId === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        setReveal((previous) =>
          previous.combatId === finishedId
            ? previous
            : { combatId: finishedId, count: previous.count + 1 },
        );
      },
      reducedMotion ? 0 : REVEAL_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [finishedId, reducedMotion]);
  const nextRevealed = finishedId !== undefined && reveal.combatId === finishedId;

  const showingCombat = response !== undefined && !(state.phase === 'finished' && nextRevealed);
  const encounter: EncounterDto | null = showingCombat
    ? { stage: response.combat.stage, enemy: response.combat.enemy }
    : player.progression.encounter;

  // The scene shows a new enemy only when the one on screen really changes:
  // never at the start of a fight, always when the next one is revealed.
  const sceneEncounterKey =
    encounter === null
      ? 'none'
      : `${String(reveal.count)}|${encounter.stage.number}|${encounter.enemy.archetypeId}`;
  const latestEncounter = useRef(encounter);
  useEffect(() => {
    latestEncounter.current = encounter;
  });
  useEffect(() => {
    const current = latestEncounter.current;
    if (sceneStatus !== 'ready' || current === null) {
      return;
    }
    scene.current?.showEncounter(
      { archetypeId: current.enemy.archetypeId, stageKind: current.stage.kind },
      { entrance: true },
    );
  }, [scene, sceneStatus, sceneEncounterKey]);

  // --- Health shown on the battlefield --------------------------------------
  const heroHealth: CombatantHealth =
    showingCombat && frame !== undefined
      ? {
          current: frame.heroHealth,
          max: response.combat.hero.maxHealth,
          ratio: frame.heroRatio,
        }
      : full(player.progression.hero.maxHealth);
  const enemyHealth: CombatantHealth | undefined =
    showingCombat && frame !== undefined
      ? {
          current: frame.enemyHealth,
          max: response.combat.enemy.maxHealth,
          ratio: frame.enemyRatio,
        }
      : encounter === null
        ? undefined
        : full(encounter.enemy.maxHealth);

  // --- HUD: the state before the combat until it has been shown -------------
  const hud: HudValues =
    state.phase === 'fighting'
      ? { ...state.response.before, stageKind: state.response.combat.stage.kind }
      : {
          level: player.character.level,
          experience: player.character.experience,
          experienceToNextLevel: player.progression.experienceToNextLevel,
          gold: player.character.gold,
          currentStage: player.progression.currentStage,
          highestStageCleared: player.progression.highestStageCleared,
          stageKind: player.progression.encounter?.stage.kind,
        };

  // --- The pacing gate, as the server set it ---------------------------------
  const readyAt =
    state.phase === 'fighting' || state.phase === 'finished'
      ? localReadyAt(
          state.response.progression.nextCombatAt,
          state.response.serverTime,
          state.receivedAt,
        )
      : localReadyAt(player.progression.nextCombatAt, player.serverTime, receivedAt);
  const now = useNow(readyAt);
  const waitSeconds = Math.max(0, Math.ceil((readyAt - now) / 1_000));

  const report: ReportState =
    state.phase === 'failed'
      ? { kind: 'failed', failure: state.failure }
      : state.phase === 'requesting'
        ? { kind: 'requesting', encounter }
        : state.phase === 'fighting'
          ? { kind: 'fighting', response: state.response }
          : state.phase === 'finished'
            ? {
                kind: 'finished',
                response: state.response,
                next: nextRevealed ? player.progression.encounter : undefined,
              }
            : { kind: 'waiting', encounter };

  const retrying = state.phase === 'failed' && state.failure.retryable;
  const busy = state.phase === 'requesting' || state.phase === 'fighting';
  const blocked =
    busy ||
    stageSelection.pending ||
    offlinePending ||
    player.progression.encounter === null ||
    (!retrying && waitSeconds > 0) ||
    (state.phase === 'failed' && state.failure.kind === 'session');
  const fightLabel =
    offlinePending && !busy
      ? 'Returning…'
      : state.phase === 'requesting'
        ? 'Engaging…'
        : state.phase === 'fighting'
          ? 'Fighting…'
          : retrying
            ? 'Try again'
            : waitSeconds > 0
              ? `Ready in ${String(waitSeconds)}s`
              : player.progression.encounter?.stage.kind === 'BOSS'
                ? 'Fight boss'
                : 'Fight';

  const auto = useAutoBattle(
    session,
    {
      resultShown: nextRevealed,
      readyAt,
      stateReceivedAt: receivedAt,
      hasEncounter: player.progression.encounter !== null,
      otherWritePending: stageSelection.pending || offlinePending,
    },
    !signingOut,
  );
  const modeLabel =
    player.progression.stageMode === 'FARM'
      ? `Farming stage ${formatStage(player.progression.currentStage)}`
      : 'Climbing';

  return (
    <div className="mx-auto flex h-dvh w-full max-w-screen-sm flex-col overflow-hidden bg-background md:my-4 md:h-[calc(100dvh-2rem)] md:max-w-2xl md:rounded-(--radius-panel) md:border md:border-border md:shadow-(--shadow-raised)">
      <GameHud
        displayName={player.profile.displayName}
        heroName={player.character.name}
        values={hud}
        signingOut={signingOut}
        onSignOut={onSignOut}
      />
      <StageSelector
        progression={player.progression}
        // Only while a combat request is in flight. A combat being played is
        // already committed, so a new choice simply applies to the next fight;
        // auto-battle would otherwise lock the choice almost all the time.
        locked={state.phase === 'requesting'}
        pending={stageSelection.pending}
        error={stageSelection.error}
        onSelect={stageSelection.select}
        onDismissError={stageSelection.clearError}
      />

      <OfflineSummary claim={offlineClaim} />

      <main className="flex min-h-0 flex-1 flex-col">
        <CombatStage
          host={host}
          sceneStatus={sceneStatus}
          encounter={encounter}
          heroName={player.character.name}
          heroHealth={heroHealth}
          enemyHealth={enemyHealth}
          outcome={
            state.phase === 'finished' && !nextRevealed ? state.response.combat.outcome : undefined
          }
          lastCritical={state.phase === 'fighting' && lastCritical}
        />
        <CombatReport report={report} />
      </main>

      <BattleControls
        fight={{
          label: fightLabel,
          disabled: blocked,
          busy,
          variant:
            player.progression.encounter?.stage.kind === 'BOSS' && !busy ? 'danger' : 'primary',
          onFight: fight,
        }}
        onSkip={state.phase === 'fighting' ? end : undefined}
        auto={auto}
        autoUnavailable={
          signingOut ||
          player.progression.encounter === null ||
          (state.phase === 'failed' && state.failure.kind === 'session')
        }
        modeLabel={modeLabel}
      />
    </div>
  );
}

function full(maxHealth: string): CombatantHealth {
  return { current: maxHealth, max: maxHealth, ratio: hugeRatio(maxHealth, maxHealth) };
}
