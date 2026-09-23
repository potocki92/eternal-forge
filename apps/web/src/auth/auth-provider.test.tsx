import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-provider';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

/**
 * The slice of the Supabase client the provider uses, driven by the test.
 * Everything else about the client is irrelevant to these behaviours.
 */
function fakeSupabase() {
  let listener: Listener | undefined;
  const auth = {
    onAuthStateChange: vi.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn(() => {
      listener?.('SIGNED_OUT', null);
      return Promise.resolve({ error: null });
    }),
  };
  const client = { auth } as unknown as SupabaseClient;

  return {
    client,
    auth,
    emit(event: AuthChangeEvent, session: Session | null) {
      act(() => {
        listener?.(event, session);
      });
    },
  };
}

function session(userId: string): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: `${userId}@example.test` },
  } as unknown as Session;
}

function Probe() {
  const { state, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">
        {state.status === 'authenticated' ? `authenticated:${state.userId}` : state.status}
      </span>
      {state.status === 'unauthenticated' ? (
        <span data-testid="reason">{state.reason ?? 'none'}</span>
      ) : null}
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    </div>
  );
}

function setup() {
  const supabase = fakeSupabase();
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={supabase.client}>{children}</AuthProvider>
    </QueryClientProvider>
  );
  render(<Probe />, { wrapper });
  return { supabase, queryClient };
}

describe('AuthProvider', () => {
  it('stays in a loading state until the stored session is resolved', () => {
    setup();

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('reflects the restored session', () => {
    const { supabase } = setup();

    supabase.emit('INITIAL_SESSION', session('alice'));

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated:alice');
  });

  it('drops every cached query when a different account signs in', () => {
    const { supabase, queryClient } = setup();
    supabase.emit('INITIAL_SESSION', session('alice'));
    queryClient.setQueryData(['player', 'alice', 'state'], { name: 'Alice' });

    supabase.emit('SIGNED_IN', session('bob'));

    expect(queryClient.getQueryData(['player', 'alice', 'state'])).toBeUndefined();
  });

  it('keeps the cache across a token refresh for the same account', () => {
    const { supabase, queryClient } = setup();
    supabase.emit('INITIAL_SESSION', session('alice'));
    queryClient.setQueryData(['player', 'alice', 'state'], { name: 'Alice' });

    supabase.emit('TOKEN_REFRESHED', session('alice'));

    expect(queryClient.getQueryData(['player', 'alice', 'state'])).toEqual({ name: 'Alice' });
  });

  it('clears state immediately and explains a player-initiated sign-out', async () => {
    const { supabase, queryClient } = setup();
    supabase.emit('INITIAL_SESSION', session('alice'));
    queryClient.setQueryData(['player', 'alice', 'state'], { name: 'Alice' });

    await act(async () => {
      screen.getByRole('button', { name: 'sign out' }).click();
      await Promise.resolve();
    });

    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(queryClient.getQueryData(['player', 'alice', 'state'])).toBeUndefined();
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('reason')).toHaveTextContent('signed-out');
  });

  it('hides player data before the sign-out request completes', async () => {
    const { supabase, queryClient } = setup();
    supabase.emit('INITIAL_SESSION', session('alice'));
    queryClient.setQueryData(['player', 'alice', 'state'], { name: 'Alice' });
    // A sign-out whose network round trip never finishes and never emits.
    supabase.auth.signOut.mockImplementationOnce(() => new Promise(() => undefined));

    await act(async () => {
      screen.getByRole('button', { name: 'sign out' }).click();
      await Promise.resolve();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(queryClient.getQueryData(['player', 'alice', 'state'])).toBeUndefined();
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
  });

  it('clears the cache when the session ends elsewhere (another tab, failed refresh)', () => {
    const { supabase, queryClient } = setup();
    supabase.emit('INITIAL_SESSION', session('alice'));
    queryClient.setQueryData(['player', 'alice', 'state'], { name: 'Alice' });

    supabase.emit('SIGNED_OUT', null);

    expect(queryClient.getQueryData(['player', 'alice', 'state'])).toBeUndefined();
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
  });
});
