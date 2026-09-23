import {
  stageSelectionRequestSchema,
  type CombatResponse,
  type OfflineProgressResponse,
  type PlayerStateResponse,
  type StageSelectionRequest,
} from '@eternal-forge/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource } from '@/auth/access-token-source';
import { usePlayerState } from '@/player/use-player';
import { combatResponseFixture, offlineProgressFixture, playerStateFixture } from '@/test/fixtures';
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
  | CombatResponse
  | { readonly status: number; readonly body?: unknown }
  /** Answers only once released: a request still in flight. */
  | { readonly hold: Promise<void>; readonly then: CombatResponse }
  | 'offline';

let combatReplies: CombatReply[];
/** How the server answers offline claims, in order; "nothing to collect" once empty. */
type OfflineReply =
  | OfflineProgressResponse
  | { readonly status: number; readonly body?: unknown }
  | 'offline'
  | { readonly hold: Promise<void>; readonly then: OfflineProgressResponse };
let offlineReplies: OfflineReply[];
const offlineKeys: string[] = [];
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
  const currentStage =
    body.mode === 'FARM' ? body.stage : serverState.progression.highestStageReached;
  const { encounter } = serverState.progression;
  serverState = {
    ...serverState,
    progression: {
      ...serverState.progression,
      stageMode: body.mode,
      currentStage,
      encounter:
        encounter === null
          ? null
          : { ...encounter, stage: { ...encounter.stage, number: currentStage } },
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
  if (init.method === 'POST' && url.pathname.endsWith('/offline-progress')) {
    offlineKeys.push(new Headers(init.headers).get('idempotency-key') ?? '');
    // The claim carries no time and no gameplay value.
    expect(init.body).toBeUndefined();
    let reply = offlineReplies.shift() ?? offlineProgressFixture('nothing');
    if (reply === 'offline') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if ('hold' in reply) {
      await reply.hold;
      reply = reply.then;
    }
    if ('offline' in reply) {
      const answer = {
        ...reply,
        progression: serverState.progression,
        serverTime: serverState.serverTime,
      };
      serverState = { ...serverState, character: answer.character };
      return json(answer, reply.offline.fights > 0 ? 201 : 200);
    }
    return json(reply.body ?? {}, reply.status);
  }
  if (init.method === 'POST') {
    combatKeys.push(new Headers(init.headers).get('idempotency-key') ?? '');
    // The combat request carries no gameplay input at all.
    expect(init.body).toBeUndefined();
    let reply = combatReplies.shift() ?? 'offline';
    if (reply === 'offline') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if ('hold' in reply) {
      await reply.hold;
      reply = reply.then;
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

function Harness({
  sceneFactory,
  signingOut = false,
}: {
  readonly sceneFactory: CombatSceneFactory;
  readonly signingOut?: boolean;
}) {
  const player = usePlayerState();
  if (player.data?.kind !== 'provisioned') {
    return null;
  }
  return (
    <GameScreen
      userId={USER_ID}
      player={player.data.state}
      receivedAt={player.dataUpdatedAt}
      signingOut={signingOut}
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
  offlineReplies = [];
  offlineKeys.length = 0;
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

describe('GameScreen — offline progress (ADR-023)', () => {
  it('asks the server once on entry, before any fight, and sends no time', async () => {
    renderGame(readyPlayer());
    expect(fightButton()).toBeDisabled();
    await advance(0);

    expect(offlineKeys).toHaveLength(1);
    expect(fightButton()).toBeEnabled();
    // Nothing to collect: no summary at all.
    expect(screen.queryByTestId('offline-summary')).not.toBeInTheDocument();
  });

  it('shows the server’s summary and the authoritative gold, then continues', async () => {
    offlineReplies = [offlineProgressFixture('collected')];
    renderGame(readyPlayer());
    await advance(0);

    expect(screen.getByTestId('offline-summary')).toBeInTheDocument();
    expect(screen.getByTestId('offline-away')).toHaveTextContent('3h 42m');
    expect(screen.queryByTestId('offline-counted')).not.toBeInTheDocument();
    expect(screen.getByTestId('offline-stage')).toHaveTextContent('1');
    expect(screen.getByTestId('offline-battles')).toHaveTextContent('24');
    expect(screen.getByTestId('offline-victories')).toHaveTextContent('24');
    expect(screen.getByTestId('offline-gold')).toHaveTextContent('+120');
    expect(screen.getByTestId('offline-levels')).toHaveTextContent('+3');
    expect(screen.getByTestId('hud-gold')).toHaveTextContent('120');
    // Nothing fights behind the reward presentation.
    expect(fightButton()).toBeDisabled();

    fireEvent.click(screen.getByTestId('offline-continue'));
    expect(screen.queryByTestId('offline-summary')).not.toBeInTheDocument();
  });

  it('shows the cap when the absence was longer than it', async () => {
    const capped = offlineProgressFixture('collected');
    offlineReplies = [
      {
        ...capped,
        offline: {
          ...capped.offline,
          elapsedMs: 52_320_000,
          rewardedMs: 28_800_000,
          capReached: true,
        },
      },
    ];
    renderGame(readyPlayer());
    await advance(0);
    expect(screen.getByTestId('offline-away')).toHaveTextContent('14h 32m');
    expect(screen.getByTestId('offline-counted')).toHaveTextContent('8h of progress collected');
  });

  it('a failed claim can be retried with the same key while fighting stays blocked', async () => {
    offlineReplies = ['offline', 'offline', 'offline', offlineProgressFixture('collected')];
    renderGame(readyPlayer());
    await advance(0);
    await advance(5_000); // the mutation's own quick retries

    expect(screen.getByTestId('offline-failed')).toBeInTheDocument();
    expect(fightButton()).toBeDisabled();
    const firstKey = offlineKeys[0];
    expect(new Set(offlineKeys)).toEqual(new Set([firstKey]));

    fireEvent.click(screen.getByTestId('offline-retry'));
    await advance(0);
    expect(offlineKeys.at(-1)).toBe(firstKey);
    expect(screen.getByTestId('offline-summary')).toBeInTheDocument();
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

  it('cannot be changed while a combat request is in flight', async () => {
    let release: () => void = () => undefined;
    combatReplies = [
      { hold: new Promise<void>((resolve) => (release = resolve)), then: combatResponseFixture() },
    ];
    renderGame(readyPlayer());
    await advance(0);

    fireEvent.click(fightButton());
    await advance(0);

    expect(report()).toHaveAttribute('data-phase', 'requesting');
    expect(toggle()).toBeDisabled();
    release();
    await advance(0);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
  });

  it('can be changed while a committed combat is being played; it applies to the next fight', async () => {
    combatReplies = [combatResponseFixture()];
    renderGame(readyPlayer());
    await advance(0);
    fireEvent.click(fightButton());
    await advance(0);
    expect(report()).toHaveAttribute('data-phase', 'fighting');

    fireEvent.click(toggle());
    await advance(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    fireEvent.change(stageInput(), { target: { value: '1' } });
    fireEvent.click(submit());
    await advance(0);

    expect(selectionBodies).toEqual([{ mode: 'FARM', stage: '1' }]);
    // The fight on screen is unchanged; the HUD still shows the state before it.
    expect(report()).toHaveAttribute('data-phase', 'fighting');
    expect(screen.getByTestId('stage-mode')).toHaveTextContent('Farming stage 1');
    await advance(4_000);
    await advance(1_200);
    expect(screen.getByTestId('next-encounter')).toHaveTextContent('Next: Stage 1');
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

describe('GameScreen — online auto battle (ADR-022)', () => {
  let pageHidden = false;

  beforeEach(() => {
    pageHidden = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (pageHidden ? 'hidden' : 'visible'),
    });
  });

  function setHidden(hidden: boolean) {
    pageHidden = hidden;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /** The server's n-th win; its gate opens `gateMs` after it answered. */
  function win(n: number, gateMs = 4_000, farmStage?: string): CombatResponse {
    const base = combatResponseFixture();
    return {
      ...base,
      combat: { ...base.combat, id: `7d9f1a52-3c4b-4e8d-9a1f-2b3c4d5e6f7${String(n)}` },
      progression: {
        ...base.progression,
        ...(farmStage === undefined ? {} : { stageMode: 'FARM', currentStage: farmStage }),
        nextCombatAt: new Date(Date.parse(base.serverTime) + gateMs).toISOString(),
      },
    };
  }

  const busyReply = {
    status: 409,
    body: { statusCode: 409, code: 'COMBAT_NOT_READY', error: 'Your hero is still fighting.' },
  };
  const startAuto = () => {
    fireEvent.click(screen.getByTestId('auto-battle-start'));
  };
  const stopAuto = () => {
    fireEvent.click(screen.getByTestId('auto-battle-stop'));
  };
  const autoStatus = () => screen.getByTestId('auto-battle-status');
  const stateReads = () => fetchMock.mock.calls.filter(([, init]) => init.method === 'GET');
  /** One whole fight on screen: playback, then the next enemy steps in. */
  const playOut = async () => {
    await advance(4_000);
    await advance(1_200);
  };

  it('starts, fights the server’s combats back to back, and stops', async () => {
    combatReplies = [win(1), win(2), win(3)];
    renderGame(readyPlayer());
    await advance(0);
    expect(screen.queryByTestId('auto-battle-status')).toBeNull();

    startAuto();
    await advance(0);

    expect(combatKeys).toHaveLength(1);
    expect(autoStatus()).toHaveAttribute('data-auto-status', 'running');
    expect(autoStatus()).toHaveTextContent('Auto battle · Climbing');
    expect(screen.getByTestId('auto-battle-stop')).toHaveTextContent('Stop auto battle');
    expect(screen.queryByTestId('fight-button')).toBeNull();
    expect(report()).toHaveAttribute('data-phase', 'fighting');

    await playOut();
    await advance(0);
    expect(combatKeys).toHaveLength(2);
    expect(new Set(combatKeys).size).toBe(2);

    stopAuto();
    await advance(0);
    expect(screen.queryByTestId('auto-battle-status')).toBeNull();
    // The fight already committed plays out; nothing new starts.
    await playOut();
    await advance(30_000);
    expect(combatKeys).toHaveLength(2);
    expect(report()).toHaveAttribute('data-outcome', 'WIN');
    expect(fightButton()).toBeEnabled();
  });

  it('waits for the server’s pacing gate and shows it as a countdown', async () => {
    combatReplies = [win(1, 8_000), win(2)];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    await playOut();
    await advance(0);
    expect(autoStatus()).toHaveAttribute('data-auto-step', 'fight');
    expect(screen.getByTestId('auto-battle-countdown')).toHaveTextContent('Next fight in 3s');
    await advance(2_700);
    expect(combatKeys).toHaveLength(1);

    await advance(200);
    expect(combatKeys).toHaveLength(2);
  });

  it('never has two requests in flight, however long the server takes', async () => {
    let release: () => void = () => undefined;
    combatReplies = [{ hold: new Promise<void>((resolve) => (release = resolve)), then: win(1) }];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();

    await advance(120_000);
    expect(combatKeys).toHaveLength(1);
    expect(report()).toHaveAttribute('data-phase', 'requesting');

    release();
    await advance(0);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
  });

  it('stop while a request is in flight: that fight completes and is shown, no other starts', async () => {
    let release: () => void = () => undefined;
    combatReplies = [
      { hold: new Promise<void>((resolve) => (release = resolve)), then: win(1) },
      win(2),
    ];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    stopAuto();
    await advance(0);
    expect(autoStatus()).toHaveAttribute('data-auto-status', 'stopping');
    expect(autoStatus()).toHaveTextContent('Auto battle stops after this fight.');
    expect(screen.getByTestId('auto-battle-stop')).toBeDisabled();

    release();
    await advance(0);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
    expect(screen.queryByTestId('auto-battle-status')).toBeNull();
    await playOut();
    await advance(30_000);
    expect(combatKeys).toHaveLength(1);
    expect(report()).toHaveAttribute('data-outcome', 'WIN');
  });

  it('retries a lost connection with the same key, after a backoff', async () => {
    // The request and both of the session's own retries are lost.
    combatReplies = ['offline', 'offline', 'offline', win(1)];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(3_000);

    expect(combatKeys).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByTestId('auto-battle-countdown')).toHaveTextContent(/^Retrying in [12]s$/u);

    await advance(2_000);
    expect(combatKeys).toHaveLength(4);
    // One intent, one key: a response lost after the server committed is replayed.
    expect(new Set(combatKeys).size).toBe(1);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
  });

  it('gives up after a long outage, says so, and stops asking', async () => {
    combatReplies = Array<CombatReply>(40).fill('offline');
    renderGame(readyPlayer());
    await advance(0);
    startAuto();

    for (let second = 0; second < 120; second += 1) {
      await advance(1_000);
    }
    const sent = combatKeys.length;
    // Five failed intents, each the request and its two quick retries.
    expect(sent).toBe(15);
    expect(autoStatus()).toHaveAttribute('data-auto-status', 'halted');
    expect(autoStatus()).toHaveTextContent('The forge cannot be reached');

    await advance(120_000);
    expect(combatKeys).toHaveLength(sent);
    expect(screen.getByTestId('auto-battle-start')).toBeEnabled();
  });

  it('an ended session stops the loop', async () => {
    combatReplies = [
      { status: 401, body: { statusCode: 401, code: 'UNAUTHENTICATED', error: 'Sign in.' } },
      win(1),
    ];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    expect(autoStatus()).toHaveAttribute('data-auto-status', 'halted');
    expect(autoStatus()).toHaveTextContent('Your session has ended.');
    await advance(60_000);
    expect(combatKeys).toHaveLength(1);
    expect(screen.getByTestId('auto-battle-start')).toBeDisabled();
  });

  it('after "still fighting" (another tab won), re-reads the server, then fights with a new key', async () => {
    combatReplies = [busyReply, win(1)];
    renderGame(readyPlayer());
    await advance(0);
    const readsBefore = stateReads().length;
    startAuto();
    await advance(0);

    expect(combatKeys).toHaveLength(1);
    expect(stateReads().length).toBeGreaterThan(readsBefore);
    await advance(990);
    expect(combatKeys).toHaveLength(1);

    await advance(20);
    expect(combatKeys).toHaveLength(2);
    expect(combatKeys[1]).not.toBe(combatKeys[0]);
    expect(report()).toHaveAttribute('data-phase', 'fighting');
  });

  it('stops when the server has no enemy this deep', async () => {
    combatReplies = [
      { status: 409, body: { statusCode: 409, code: 'STAGE_NOT_PLAYABLE', error: 'Too deep.' } },
    ];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    expect(autoStatus()).toHaveAttribute('data-auto-status', 'halted');
    expect(autoStatus()).toHaveTextContent('No enemy is known this deep yet.');
    await advance(60_000);
    expect(combatKeys).toHaveLength(1);
  });

  it('a stage choice while running: the next fight waits for the server’s answer', async () => {
    let release: () => void = () => undefined;
    selectionReplies = [{ hold: new Promise<void>((resolve) => (release = resolve)) }, 'accept'];
    // The server's answers after the choice reflect it: it fights where the hero stands.
    combatReplies = [win(1), win(2, 4_000, '1'), win(3)];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    // Climbing → farm stage 1, chosen while the first fight plays.
    fireEvent.click(screen.getByTestId('stage-selector-toggle'));
    await advance(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Stay on this stage' }));
    fireEvent.change(screen.getByLabelText('Stage to farm'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('stage-selection-submit'));
    await playOut();
    await advance(5_000);

    expect(combatKeys).toHaveLength(1);
    expect(autoStatus()).toHaveTextContent('Auto battle waits for your stage choice.');

    release();
    await advance(10);
    expect(combatKeys).toHaveLength(2);
    expect(autoStatus()).toHaveTextContent('Auto battle · Farming stage 1');

    // Farm → climbing, during the second fight: shown at once, used next.
    fireEvent.click(screen.getByTestId('stage-selector-toggle'));
    await advance(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Continue climbing' }));
    fireEvent.click(screen.getByTestId('stage-selection-submit'));
    await advance(0);
    expect(autoStatus()).toHaveTextContent('Auto battle · Climbing');
    expect(selectionBodies).toEqual([{ mode: 'FARM', stage: '1' }, { mode: 'PROGRESS' }]);

    await playOut();
    await advance(0);
    expect(combatKeys).toHaveLength(3);
  });

  it('pauses while the page is hidden and never catches up for the hidden time', async () => {
    combatReplies = [win(1), win(2), win(3)];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    setHidden(true);
    await playOut();
    await advance(10 * 60_000);
    expect(combatKeys).toHaveLength(1);
    expect(autoStatus()).toHaveTextContent('Auto battle paused while the game is hidden.');

    setHidden(false);
    await advance(0);
    // Back on screen, the absence is offered to the server as an offline
    // claim first (ADR-023)…
    expect(offlineKeys).toHaveLength(2);
    // (This fake answers with the server time of the last combat, so the
    // gate it reports is read from the moment the claim arrived.)
    await advance(4_000);
    // …then one fight — not one for every gate that opened while hidden.
    expect(combatKeys).toHaveLength(2);
    await advance(1_000);
    expect(combatKeys).toHaveLength(2);
  });

  it('stops on unmount: no timer survives the screen', async () => {
    combatReplies = [win(1), win(2)];
    const view = renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    view.unmount();
    await advance(60_000);
    expect(combatKeys).toHaveLength(1);
  });

  it('stops at once when the player signs out', async () => {
    combatReplies = [win(1), win(2)];
    const view = renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    view.rerender(<Harness sceneFactory={recordingScene} signingOut />);
    await advance(0);
    expect(screen.queryByTestId('auto-battle-status')).toBeNull();
    await playOut();
    await advance(60_000);
    expect(combatKeys).toHaveLength(1);
  });

  it('skipping the animation never skips the server’s gate', async () => {
    combatReplies = [win(1, 4_000), win(2)];
    renderGame(readyPlayer());
    await advance(0);
    startAuto();
    await advance(0);

    fireEvent.click(screen.getByTestId('skip-button'));
    await advance(1_200);
    await advance(0);
    expect(combatKeys).toHaveLength(1);
    expect(screen.getByTestId('auto-battle-countdown')).toHaveTextContent('Next fight in 3s');

    await advance(2_800);
    expect(combatKeys).toHaveLength(2);
  });
});
