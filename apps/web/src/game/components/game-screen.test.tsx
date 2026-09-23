import type { CombatResponse, PlayerStateResponse } from '@eternal-forge/contracts';
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn((url: URL, init: RequestInit) => {
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
  return Promise.resolve(json(serverState, 200));
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
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
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
      character: { ...state.character, stage: '10' },
      progression: {
        ...state.progression,
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
