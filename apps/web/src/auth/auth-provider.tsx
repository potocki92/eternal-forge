'use client';

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AccessTokenSource } from './access-token-source';
import { describeAuthError } from './auth-errors';
import { getSupabaseClient } from './supabase-client';

/** Why the player is signed out, when the UI should say so. */
export type SignedOutReason = 'signed-out' | 'expired';

export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'unauthenticated'; readonly reason: SignedOutReason | undefined }
  | {
      readonly status: 'authenticated';
      readonly userId: string;
      readonly email: string | undefined;
    };

export type AuthActionResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type SignUpResult = AuthActionResult | { readonly ok: true; readonly confirmEmail: true };

export interface AuthContextValue {
  readonly state: AuthState;
  readonly signIn: (email: string, password: string) => Promise<AuthActionResult>;
  readonly signUp: (email: string, password: string) => Promise<SignUpResult>;
  readonly signOut: () => Promise<void>;
  readonly tokens: AccessTokenSource;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthProviderProps {
  readonly children: ReactNode;
  /** Injected by tests; the application uses the browser singleton. */
  readonly client?: SupabaseClient;
}

/**
 * Owns the browser's authentication state (ADR-016).
 *
 * Supabase Auth holds the session; this provider mirrors only *who* is signed
 * in, which is the one piece of client state every screen needs. Player data
 * stays in TanStack Query, keyed by user id, and the whole query cache is
 * dropped whenever the signed-in user changes or signs out, so a screen can
 * never render the previous account's data.
 */
export function AuthProvider({ children, client: injectedClient }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const clientRef = useRef<SupabaseClient | undefined>(injectedClient);
  const currentUserId = useRef<string | undefined>(undefined);
  /** Set just before a sign-out this provider initiates, to explain it on the sign-in page. */
  const pendingReason = useRef<SignedOutReason | undefined>(undefined);

  const client = useCallback((): SupabaseClient => {
    clientRef.current ??= getSupabaseClient();
    return clientRef.current;
  }, []);

  const applySession = useCallback(
    (session: Session | null) => {
      const userId = session?.user.id;

      if (userId !== currentUserId.current) {
        // A different account (or none): nothing cached may survive.
        queryClient.clear();
        currentUserId.current = userId;
      }

      if (session === null) {
        setState({ status: 'unauthenticated', reason: pendingReason.current });
        pendingReason.current = undefined;
      } else {
        setState({ status: 'authenticated', userId: session.user.id, email: session.user.email });
      }
    },
    [queryClient],
  );

  useEffect(() => {
    // Fires INITIAL_SESSION once the stored session is restored (or refreshed),
    // then every sign-in, sign-out and refresh — including those from other tabs.
    // The callback stays synchronous: awaiting Supabase inside it can deadlock.
    const { data } = client().auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [applySession, client]);

  const endLocally = useCallback(
    async (reason: SignedOutReason) => {
      pendingReason.current = reason;
      // Hide account data before the network round trip, not after it.
      currentUserId.current = undefined;
      setState({ status: 'unauthenticated', reason });
      queryClient.clear();
      await client().auth.signOut({ scope: 'local' });
    },
    [client, queryClient],
  );

  const tokens = useMemo<AccessTokenSource>(
    () => ({
      async getAccessToken() {
        const { data } = await client().auth.getSession();
        return data.session?.access_token ?? null;
      },
      async refreshAccessToken() {
        const { data, error } = await client().auth.refreshSession();
        return error === null ? (data.session?.access_token ?? null) : null;
      },
      expireSession: () => endLocally('expired'),
    }),
    [client, endLocally],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      tokens,
      signIn: async (email, password) => {
        const { error } = await client().auth.signInWithPassword({ email, password });
        return error === null ? { ok: true } : { ok: false, message: describeAuthError(error) };
      },
      signUp: async (email, password) => {
        const { data, error } = await client().auth.signUp({ email, password });
        if (error !== null) {
          return { ok: false, message: describeAuthError(error) };
        }
        // With email confirmation enabled Supabase returns no session yet.
        return data.session === null ? { ok: true, confirmEmail: true } : { ok: true };
      },
      signOut: () => endLocally('signed-out'),
    }),
    [client, endLocally, state, tokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}
