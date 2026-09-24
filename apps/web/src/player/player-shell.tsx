'use client';

import { Alert, Button, Panel, Skeleton } from '@eternal-forge/ui';
import { useState } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { GameScreen } from '@/game/components/game-screen';
import { GearScreen } from '@/gear/gear-screen';
import { ApiError } from '@/lib/api-client';
import { CreatePlayerForm } from './create-player-form';
import { usePlayerState } from './use-player';

/**
 * The signed-in player's screen: the game once a hero exists, the first-run
 * "Name your hero" form before, and loading and error states around both.
 */
export function PlayerShell({ view = 'combat' }: { readonly view?: 'combat' | 'gear' }) {
  const { state: auth, signOut } = useAuth();
  const player = usePlayerState();
  const [signingOut, setSigningOut] = useState(false);

  const startSignOut = () => {
    setSigningOut(true);
    void signOut();
  };

  if (player.data?.kind === 'provisioned' && auth.status === 'authenticated') {
    // Keyed by user: a different account always starts from a fresh screen.
    return view === 'combat' ? (
      <GameScreen
        key={auth.userId}
        userId={auth.userId}
        player={player.data.state}
        receivedAt={player.dataUpdatedAt}
        signingOut={signingOut}
        onSignOut={startSignOut}
      />
    ) : (
      <GearScreen
        key={auth.userId}
        userId={auth.userId}
        characterId={player.data.state.character.id}
        heroName={player.data.state.character.name}
        signingOut={signingOut}
        onSignOut={startSignOut}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-6 px-4 py-6 md:max-w-3xl md:py-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase">
            Eternal Forge
          </span>
          <span className="truncate text-sm text-text-secondary">Signed in</span>
        </div>
        <Button variant="secondary" disabled={signingOut} onClick={startSignOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </header>

      <main className="flex flex-col gap-6">
        {player.isPending ? <PlayerSkeleton /> : null}

        {player.isError ? (
          <Panel className="flex flex-col gap-3">
            <Alert tone="danger">
              {player.error instanceof ApiError
                ? player.error.message
                : 'Your hero could not be loaded.'}
            </Alert>
            <Button
              variant="secondary"
              onClick={() => void player.refetch()}
              disabled={player.isFetching}
            >
              {player.isFetching ? 'Retrying…' : 'Try again'}
            </Button>
          </Panel>
        ) : null}

        {player.data?.kind === 'not-provisioned' ? <CreatePlayerForm /> : null}
      </main>
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        Loading your hero…
      </p>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
