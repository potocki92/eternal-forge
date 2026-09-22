import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceStatus } from './service-status';

function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServiceStatus', () => {
  it('lists each dependency with its own state', async () => {
    stubFetch({
      status: 'ok',
      service: 'eternal-forge-api',
      version: '1.2.3',
      serverTime: '2026-09-22T10:00:00.000Z',
      dependencies: [
        { name: 'postgres', status: 'ok', durationMs: 3 },
        { name: 'redis', status: 'ok', durationMs: 1 },
      ],
    });

    render(<ServiceStatus />, { wrapper });

    expect(await screen.findByText('postgres')).toBeInTheDocument();
    expect(screen.getByText('redis')).toBeInTheDocument();
    expect(screen.getAllByText('Operational').length).toBeGreaterThan(0);
  });

  it('explains an unreachable API without exposing transport detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('connect ECONNREFUSED 127.0.0.1:3001'))),
    );

    render(<ServiceStatus />, { wrapper });

    expect(await screen.findByText(/could not be reached/u)).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/u)).not.toBeInTheDocument();
  });
});
