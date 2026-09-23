'use client';

import type { PlayerStateResponse } from '@eternal-forge/contracts';
import { Alert, Button, Panel, Skeleton } from '@eternal-forge/ui';
import { useState } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { CreatePlayerForm } from './create-player-form';
import { usePlayerState } from './use-player';

const integer = new Intl.NumberFormat('en-US');

/**
 * The signed-in player's home screen for Phase 2: who they are, their hero and
 * where the hero stands. The combat screen replaces the body in Phase 3.
 */
export function PlayerShell() {
  const { signOut } = useAuth();
  const player = usePlayerState();
  const [signingOut, setSigningOut] = useState(false);

  const displayName =
    player.data?.kind === 'provisioned' ? player.data.state.profile.displayName : undefined;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-6 px-4 py-6 md:max-w-3xl md:py-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase">
            Eternal Forge
          </span>
          <span className="truncate text-sm text-text-secondary" data-testid="signed-in-as">
            {displayName === undefined ? 'Signed in' : `Signed in as ${displayName}`}
          </span>
        </div>
        <Button
          variant="secondary"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
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
        {player.data?.kind === 'provisioned' ? <PlayerOverview state={player.data.state} /> : null}
      </main>
    </div>
  );
}

function PlayerOverview({ state }: { readonly state: PlayerStateResponse }) {
  const { profile, character } = state;

  return (
    <>
      <section aria-labelledby="player-heading" className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase">Player</p>
        <h1 id="player-heading" className="font-display text-3xl text-text-primary">
          {profile.displayName}
        </h1>
      </section>

      <Panel as="section" aria-labelledby="character-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase">Hero</p>
          <h2 id="character-heading" className="font-display text-2xl text-text-primary">
            {character.name}
          </h2>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Level" value={integer.format(character.level)} />
          <Stat label="Stage" value={integer.format(character.stage)} />
        </dl>
      </Panel>

      <Panel as="section" aria-labelledby="next-heading" className="flex flex-col gap-2">
        <h2 id="next-heading" className="text-sm font-semibold text-text-primary">
          The forge is being lit
        </h2>
        <p className="text-sm text-text-secondary">
          Your hero is saved to your account. Combat is not available yet.
        </p>
      </Panel>
    </>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius-control) bg-surface-elevated px-3 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="font-mono text-lg text-text-primary">{value}</dd>
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
