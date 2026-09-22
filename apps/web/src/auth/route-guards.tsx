'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { FullScreenStatus } from '@/components/full-screen-status';
import { useAuth } from './auth-provider';

/**
 * Renders children only for a signed-in player; otherwise sends them to sign-in.
 *
 * This is navigation, not security: every piece of data behind it comes from
 * the API, which verifies the access token on each request (ADR-016).
 */
export function RequireAuth({ children }: { readonly children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== 'unauthenticated') {
      return;
    }
    if (state.reason === 'expired') {
      router.replace('/login?reason=expired');
    } else if (state.reason === 'signed-out') {
      router.replace('/login?reason=signed-out');
    } else {
      router.replace('/login');
    }
  }, [router, state]);

  if (state.status !== 'authenticated') {
    return (
      <FullScreenStatus
        label={state.status === 'loading' ? 'Restoring your session…' : 'Redirecting to sign in…'}
      />
    );
  }

  return children;
}

/** Sign-in and registration pages: a signed-in player goes straight to the game. */
export function GuestOnly({ children }: { readonly children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'authenticated') {
      router.replace('/play');
    }
  }, [router, state.status]);

  if (state.status === 'authenticated') {
    return <FullScreenStatus label="Entering the forge…" />;
  }

  return children;
}
