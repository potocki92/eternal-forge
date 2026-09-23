import {
  stageSelectionRequestSchema,
  type CombatResponse,
  type PlayerStateResponse,
  type StageSelectionRequest,
} from '@eternal-forge/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { usePlayerState } from '@/player/use-player';
import { combatResponseFixture, playerStateFixture } from '@/test/fixtures';
import type { CombatScene, CombatSceneFactory, SceneHit } from '../scene/combat-scene';
import { GameScreen } from './game-screen';

const USER_ID = 'user-1';

const tokens: AccessTokenSource = {
  getAccessToken: () => Promise.resolve('token'),
  refreshAccessToken: () => Promise.resolve(null),
  expireSession: () => Promise.resolve(),
};

vi.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({
    state: { status: 'authenticated', userId: USER_ID, email: undefined },
    tokens,
  }),
}));

// --- A scriptable API --------------------------------------------------------

type CombatReply =
  CombatResponse | { readonly status: number; readonly body?: unknown } | 'offline';

let combatReplies: CombatReply[];
let serverState: PlayerStateResponse;
const combatKeys: string[] = [];

/** How the server answers the next stage selection. */
type SelectionReply =
  'accept' | { readonly status: number; readonly body: unknown } | { readonly hold: Promise<void> };
let selectionReplies: SelectionReply[];
/**
 * When set, the next player-state read captures the server state *now* and
 * answers only once released: a read that started before a write.
 */
let heldStateRead: Promise<void> | undefined;
let queryClient: QueryClient;
const selectionBodies: unknown[] = [];

/** The server's own rule, for the fake: FARM stays, PROGRESS returns to the frontier. */
function acceptSelection(body: StageSelectionRequest) {
  serverState = {
    ...serverState,
    progression: {
      ...serverState.progression,
      stageMode: body.mode,
      currentStage: body.mode === 'FARM' ? body.stage : serverState.progression.highestStageReached,
    },
  };
  return {
    character: serverState.character,
    progression: serverState.progression,
    serverTime: serverState.serverTime,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
  if (init.method === 'PUT') {
    expect(url.pathname).toMatch(/\/stage-selection$/u);
    // The client must send exactly the shared contract's request.
    const body = stageSelectionRequestSchema.parse(
      JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
    );
    selectionBodies.push(body);
    const reply = selectionReplies.shift() ?? 'accept';
    if (reply !== 'accept' && 'hold' in reply) {
      await reply.hold;
    }
    if (reply !== 'accept' && 'status' in reply) {
      return json(reply.body, reply.status);
    }
    return json(acceptSelection(body), 200);
  }
  if (init.method === 'POST') {
    combatKeys.push(new Headers(init.headers).get('idempotency-key') ?? '');
    const reply = combatReplies.shift() ?? 'offline';
    if (reply === 'offline') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if ('combat' in reply) {
      serverState = {
        ...serverState,
        character: reply.character,
        progression: reply.progression,
        serverTime: reply.serverTime,
      };
      return Promise.resolve(json(reply, 201));
    }
    return Promise.resolve(json(reply.body ?? {}, reply.status));
  }
  expect(url.pathname).toBe('/player/state');
  const snapshot = serverState;
  if (heldStateRead !== undefined) {
    const hold = heldStateRead;
    heldStateRead = undefined;
    await hold;
  }
  return json(snapshot, 200);
});

// --- A scene that records what it was told ------------------------------------

interface SceneLog {
  readonly encounters: string[];
  readonly hits: SceneHit[];
  readonly outcomes: string[];
}

let sceneLog: SceneLog;
const recordingScene: CombatSceneFactory = () => {
  const scene: CombatScene = {
    showEncounter: (encounter) => {
      sceneLog.encounters.push(`${encounter.archetypeId}:${encounter.stageKind}`);
    },
    playHit: (hit) => {
      sceneLog.hits.push(hit);
    },
    showOutcome: (outcome) => {
      sceneLog.outcomes.push(outcome);
    },
    destroy: () => undefined,
  };
  return Promise.resolve(scene);
};

function Harness({ sceneFactory }: { readonly sceneFactory: CombatSceneFactory }) {
  const player = usePlayerState();
  if (player.data?.kind !== 'provisioned') {
    return null;
  }
  return (
    <GameScreen
      userId={USER_ID}
      player={player.data.state}
      receivedAt={player.dataUpdatedAt}
      signingOut={false}
      onSignOut={() => undefined}
      sceneFactory={sceneFactory}
    />
  );
}

function renderGame(initial: PlayerStateResponse, sceneFactory = recordingScene) {
  serverState = initial;
  const client = (queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  }));
  client.setQueryData(['player', USER_ID, 'state'], { kind: 'provisioned', state: initial });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Harness sceneFactory={sceneFactory} />, { wrapper });
}

/** A player whose server clock matches the combat fixture's timeline. */
function readyPlayer(): PlayerStateResponse {
  const state = playerStateFixture();
  return { ...state, serverTime: state.progression.nextCombatAt };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const fightButton = () => screen.getByTestId('fight-button');
const report = () => screen.getByTestId('combat-report');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  fetchMock.mockClear();
  combatKeys.length = 0;
  combatReplies = [];
  selectionReplies = [];
  heldStateRead = undefined;
  selectionBodies.length = 0;
  sceneLog = { encounters: [], hits: [], outcomes: [] };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GameScreen — before a fight', () => {
  it('shows the server’s encounter, hero and progress', async () => {
    renderGame(readyPlayer());
    await advance(0);

    expect(screen.getByTestId('combat-status')).toHaveTextContent('Stage 1: Husk awaits.');
    expect(screen.getByTestId('enemy-name')).toHaveTextContent('Husk');
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('1');
    // Nothing cleared yet: a dash, announced as "none yet".
    expect(screen.getByTestId('hud-best-cleared')).toHaveTextContent('—none yet');
    expect(screen.getByTestId('hud-gold')).toHaveTextContent('0');
    expect(screen.getByRole('progressbar', { name: 'Husk health' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(fightButton()).toHaveTextContent('Fight');
    expect(fightButton()).toBeEnabled();
    expect(sceneLog.encounters).toEqual(['husk:REGULAR']);
  });

  it('treats a boss stage as the server classified it', async () => {
    const state = readyPlayer();
    renderGame({
      ...state,
      progression: {
        ...state.progression,
        currentStage: '10',
        highestStageReached: '10',
        highestStageCleared: '9',
        encounter: {
          stage: { number: '10', kind: 'BOSS' },
          enemy: { archetypeId: 'warden', maxHealth: '5.5e2', damage: '1.3e1' },
        },
      },
    });
    await advance(0);

    expect(screen.getByTestId('boss-badge')).toHaveTextContent('Boss');
    expect(screen.getByText('Boss stage')).toBeInTheDocument();
    expect(screen.getByTestId('battlefield')).toHaveAttribute('data-stage-kind', 'BOSS');
    expect(fightButton()).toHaveTextContent('Fight boss');
    expect(sceneLog.encounters).toEqual(['warden:BOSS']);
  });

  it('shows the current stage and the best stage cleared separately while farming', async () => {
    const state = readyPlayer();
    renderGame({
      ...state,
      progression: {
        ...state.progression,
        currentStage: '9',
        highestStageReached: '10',
        highestStageCleared: '9',
        encounter: {
          stage: { number: '9', kind: 'REGULAR' },
          enemy: { archetypeId: 'husk', maxHealth: '8.6e1', damage: '8e0' },
        },
      },
    });
    await advance(0);

    expect(screen.getByTestId('hud-stage')).toHaveTextContent('9');
    expect(screen.getByTestId('hud-best-cleared')).toHaveTextContent('9');
    expect(screen.getByText('stage cleared', { exact: false })).toBeInTheDocument();
  });

  it('waits for the server’s pacing gate', async () => {
    const state = readyPlayer();
    renderGame({
      ...state,
      progression: { ...state.progression, nextCombatAt: '2026-09-22T10:00:03.000Z' },
    });
    await advance(0);

    expect(fightButton()).toBeDisabled();
    expect(fightButton()).toHaveTextContent('Ready in 3s');
    await advance(3_000);
    expect(fightButton()).toBeEnabled();
  });
});

describe('GameScreen — a fight', () => {
  it('requests, plays the server’s timeline, then reveals rewards and the next enemy', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    await advance(0);

    expect(combatKeys).toHaveLength(1);
    expect(combatKeys[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
    // The HUD keeps the pre-combat state until the combat has been shown.
    expect(screen.getByTestId('hud-gold')).toHaveTextContent('0');

    await advance(2_000);
    expect(sceneLog.hits.map((hit) => hit.attacker)).toEqual(['PLAYER', 'ENEMY', 'PLAYER']);
    expect(sceneLog.hits[2]).toMatchObject({ critical: true, damageLabel: '15' });

    await advance(2_000);
    expect(report()).toHaveAttribute('data-phase', 'finished');
    expect(report()).toHaveAttribute('data-outcome', 'WIN');
    expect(screen.getByTestId('outcome-banner')).toHaveTextContent('Victory!');
    expect(screen.getByTestId('combat-status')).toHaveTextContent(
      'Victory! Stage 1 cleared. +5 gold, +3 experience.',
    );
    expect(screen.getByTestId('reward-gold')).toHaveTextContent('+5 gold');
    expect(screen.getByTestId('hud-gold')).toHaveTextContent('5');
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('2');
    expect(screen.getByTestId('hud-best-cleared')).toHaveTextContent('1');
    expect(sceneLog.hits.at(-1)).toMatchObject({ lethal: true });
    expect(sceneLog.outcomes).toEqual(['WIN']);

    await advance(1_200);
    expect(screen.getByTestId('next-encounter')).toHaveTextContent('Next: Stage 2: Husk');
    expect(screen.queryByTestId('outcome-banner')).toBeNull();
    expect(sceneLog.encounters).toEqual(['husk:REGULAR', 'husk:REGULAR']);
    expect(fightButton()).toHaveTextContent('Fight');
    expect(fightButton()).toBeEnabled();
  });

  it('sends one request however fast the button is pressed', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    fireEvent.click(fightButton());
    fireEvent.click(fightButton());
    await advance(0);

    expect(combatKeys).toHaveLength(1);
    expect(fightButton()).toBeDisabled();
  });

  it('can skip the animation; the result is the same', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);
    fireEvent.click(fightButton());
    await advance(0);

    fireEvent.click(screen.getByTestId('skip-button'));
    await advance(0);

    expect(report()).toHaveAttribute('data-outcome', 'WIN');
    expect(sceneLog.hits).toEqual([]);
    expect(sceneLog.outcomes).toEqual(['WIN']);
    expect(screen.getByRole('progressbar', { name: 'Husk health' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });
});

describe('GameScreen — failures', () => {
  it('retries a lost connection with the same idempotency key', async () => {
    // The first attempt and both automatic retries are lost.
    combatReplies = ['offline', 'offline', 'offline', combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    await advance(5_000);

    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(fightButton()).toHaveTextContent('Try again');
    expect(new Set(combatKeys).size).toBe(1);

    fireEvent.click(fightButton());
    await advance(0);

    expect(combatKeys).toHaveLength(4);
    expect(new Set(combatKeys).size).toBe(1);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
  });

  it('explains a combat refused because the hero is still fighting', async () => {
    combatReplies = [
      { status: 409, body: { statusCode: 409, code: 'COMBAT_NOT_READY', error: 'busy' } },
    ];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    await advance(0);

    expect(screen.getByRole('alert')).toHaveTextContent('Your hero is still fighting.');
    // The screen re-reads the server's state rather than guessing.
    expect(fetchMock.mock.calls.some(([, init]) => init.method !== 'POST')).toBe(true);
  });

  it('stays fully playable when the canvas renderer cannot start', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer(), () => Promise.reject(new Error('no WebGL')));
    await advance(0);

    expect(screen.getByTestId('battlefield').querySelector('[data-scene]')).toHaveAttribute(
      'data-scene',
      'unavailable',
    );
    fireEvent.click(fightButton());
    await advance(4_000);

    expect(report()).toHaveAttribute('data-outcome', 'WIN');
  });
});

describe('GameScreen — stage selection (ADR-021)', () => {
  /** Reached the stage-10 boss, lost, farming stage 9 in PROGRESS mode. */
  function belowTheWall(): PlayerStateResponse {
    const state = readyPlayer();
    return {
      ...state,
      progression: {
        ...state.progression,
        currentStage: '9',
        highestStageReached: '10',
        highestStageCleared: '9',
        encounter: {
          stage: { number: '9', kind: 'REGULAR' },
          enemy: { archetypeId: 'husk', maxHealth: '1e2', damage: '6e0' },
        },
      },
    };
  }

  const toggle = () => screen.getByTestId('stage-selector-toggle');
  const submit = () => screen.getByTestId('stage-selection-submit');
  const stageInput = () => screen.getByLabelText('Stage to farm');

  async function openSelector() {
    await advance(0);
    fireEvent.click(toggle());
    await advance(0);
  }

  it('summarises the current mode and opens an accessible form', async () => {
    renderGame(belowTheWall());
    await advance(0);

    expect(screen.getByTestId('stage-mode')).toHaveTextContent(
      'Climbing · moves on after each win',
    );
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle());
    await advance(0);

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Where should your hero fight?' })).toBeVisible();
    const climb = screen.getByRole('radio', { name: 'Continue climbing' });
    expect(climb).toBeChecked();
    expect(climb).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Stay on this stage' })).not.toBeChecked();
    // Climbing from stage 9 would return to the frontier, stage 10.
    expect(submit()).toHaveTextContent('Continue climbing');
    expect(submit()).toBeEnabled();
  });

  it('farms an earlier stage and shows the server’s answer, not a guess', async () => {
    renderGame(belowTheWall());
    await openSelector();

    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    expect(stageInput()).toHaveValue('9');
    expect(screen.getByText('Stages 1 to 10 are open.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    expect(submit()).toHaveTextContent('Farm stage 7');

    fireEvent.click(submit());
    await advance(0);

    expect(selectionBodies).toEqual([{ mode: 'FARM', stage: '7' }]);
    expect(screen.getByTestId('stage-mode')).toHaveTextContent(
      'Farming stage 7 · stays on this stage',
    );
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('7');
    expect(screen.getByTestId('hud-best-cleared')).toHaveTextContent('9');
    expect(screen.queryByTestId('stage-selector-panel')).not.toBeInTheDocument();
    expect(toggle()).toHaveFocus();
  });

  it('returns to climbing from the frontier', async () => {
    const state = belowTheWall();
    renderGame({
      ...state,
      progression: { ...state.progression, stageMode: 'FARM', currentStage: '4' },
    });
    await openSelector();

    expect(screen.getByRole('radio', { name: 'Stay on this stage' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Continue climbing' }));
    fireEvent.click(submit());
    await advance(0);

    expect(selectionBodies).toEqual([{ mode: 'PROGRESS' }]);
    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Climbing');
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('10');
  });

  it('checks a typed stage against the open range before sending anything', async () => {
    renderGame(belowTheWall());
    await openSelector();
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));

    fireEvent.change(stageInput(), { target: { value: '999999' } });

    expect(stageInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('stage-draft-error')).toHaveTextContent(
      'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
    );
    expect(submit()).toBeDisabled();
    fireEvent.submit(submit());
    await advance(0);
    expect(selectionBodies).toEqual([]);
  });

  it('shows a refusal from the server and keeps the old, authoritative state', async () => {
    renderGame(belowTheWall());
    selectionReplies = [
      {
        status: 409,
        body: {
          statusCode: 409,
          code: 'STAGE_LOCKED',
          error: 'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
        },
      },
    ];
    await openSelector();
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    fireEvent.change(stageInput(), { target: { value: '3' } });

    fireEvent.click(submit());
    await advance(0);

    expect(screen.getByTestId('stage-selection-error')).toHaveTextContent(
      'Your hero has not reached that stage yet. Stages 1 to 10 are open.',
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('9');
    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Climbing');
  });

  it('shows the saving state and blocks the fight until the server answers', async () => {
    let release: () => void = () => undefined;
    selectionReplies = [{ hold: new Promise<void>((resolve) => (release = resolve)) }];
    renderGame(belowTheWall());
    await openSelector();
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    fireEvent.click(submit());
    await advance(0);

    expect(submit()).toHaveTextContent('Saving…');
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId('stage-selector-panel')).toHaveAttribute('aria-busy', 'true');
    expect(fightButton()).toBeDisabled();
    // Regression: the pending save cannot be dismissed, so it cannot be
    // reported idle (and Fight re-enabled) while its request may commit.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(submit(), { key: 'Escape' });
    expect(screen.getByTestId('stage-selector-panel')).toBeInTheDocument();
    // Closing the form hides it but never forgets the save in flight.
    fireEvent.click(toggle());
    await advance(0);
    expect(screen.queryByTestId('stage-selector-panel')).not.toBeInTheDocument();
    expect(fightButton()).toBeDisabled();
    // Nothing optimistic: the HUD still shows the old choice.
    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Climbing');

    release();
    await advance(0);

    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Farming stage 9');
    expect(screen.queryByTestId('stage-selection-error')).not.toBeInTheDocument();
    expect(fightButton()).toBeEnabled();
  });

  it('cannot be changed while a combat is being fought', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    await advance(0);

    expect(report()).toHaveAttribute('data-phase', 'fighting');
    expect(toggle()).toBeDisabled();
  });

  it('closes on Escape without sending anything', async () => {
    renderGame(belowTheWall());
    await openSelector();

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Continue climbing' }), { key: 'Escape' });
    await advance(0);

    expect(screen.queryByTestId('stage-selector-panel')).not.toBeInTheDocument();
    expect(toggle()).toHaveFocus();
    expect(selectionBodies).toEqual([]);
  });

  it('shows a farming player’s saved choice as the server sends it (a refresh)', async () => {
    const state = belowTheWall();
    renderGame({
      ...state,
      progression: {
        ...state.progression,
        stageMode: 'FARM',
        currentStage: '9007199254740993',
        highestStageReached: '9007199254740995',
        highestStageCleared: '9007199254740994',
      },
    });
    await advance(0);

    expect(screen.getByTestId('stage-mode')).toHaveTextContent(
      'Farming stage 9,007,199,254,740,993 · stays on this stage',
    );
    fireEvent.click(toggle());
    await advance(0);
    expect(stageInput()).toHaveValue('9007199254740993');
    fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
    expect(stageInput()).toHaveValue('9007199254740994');
  });

  it('a player-state read started before the selection cannot put the old stage back', async () => {
    let releaseRead: () => void = () => undefined;
    let releaseSave: () => void = () => undefined;
    selectionReplies = [{ hold: new Promise<void>((resolve) => (releaseSave = resolve)) }];
    renderGame(belowTheWall());
    await openSelector();
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    fireEvent.change(stageInput(), { target: { value: '3' } });
    fireEvent.click(submit());
    await advance(0);

    // A refetch (as after a combat) reads the old state while the save is in flight.
    heldStateRead = new Promise<void>((resolve) => (releaseRead = resolve));
    void queryClient.invalidateQueries({ queryKey: ['player', USER_ID, 'state'] });
    await advance(0);

    releaseSave();
    await advance(0);
    releaseRead();
    await advance(0);

    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Farming stage 3');
    expect(screen.getByTestId('hud-stage')).toHaveTextContent('3');
  });
});
