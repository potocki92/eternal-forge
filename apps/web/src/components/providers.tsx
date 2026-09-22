'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/auth/auth-provider';

/**
 * Server state lives in TanStack Query; React state stays for local UI concerns
 * only (CLAUDE.md — "Frontend state"). Authentication state is provided by
 * {@link AuthProvider}, which also clears the query cache when the account
 * changes.
 *
 * The client is created inside the component so each browser session — and each
 * server render — gets its own cache rather than sharing one module-level
 * instance across requests.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
