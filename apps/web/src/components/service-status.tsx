'use client';

import { useQuery } from '@tanstack/react-query';
import { Button, Panel, StatusBadge } from '@eternal-forge/ui';
import type { ReadinessResponse } from '@eternal-forge/contracts';
import { ApiError, fetchReadiness } from '@/lib/api-client';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function toneForStatus(status: ReadinessResponse['dependencies'][number]['status']): Tone {
  if (status === 'ok') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

/**
 * Reports whether the API and its backing services are reachable.
 *
 * Server state is owned by TanStack Query; this component holds no local copy of
 * it. Errors are rendered as plain language, never as a raw backend message
 * (docs/UI_SYSTEM.md — "Error UX").
 */
export function ServiceStatus() {
  const readiness = useQuery({
    queryKey: ['readiness'],
    queryFn: ({ signal }) => fetchReadiness({ signal }),
  });

  return (
    <Panel as="section" aria-labelledby="api-status-heading" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id="api-status-heading" className="text-sm font-semibold text-text-primary">
          API
        </h2>
        {readiness.isPending ? (
          <StatusBadge tone="neutral">Checking</StatusBadge>
        ) : (
          <StatusBadge tone={readiness.data ? toneForStatus(readiness.data.status) : 'danger'}>
            {readiness.data ? statusLabel(readiness.data.status) : 'Unreachable'}
          </StatusBadge>
        )}
      </div>

      {readiness.isError ? (
        <p className="text-sm text-text-secondary">
          {readiness.error instanceof ApiError
            ? readiness.error.message
            : 'The service could not be reached.'}{' '}
          Start the API with <code className="font-mono text-text-primary">pnpm dev</code>.
        </p>
      ) : null}

      {readiness.data ? (
        <>
          <dl className="flex flex-col divide-y divide-border">
            {readiness.data.dependencies.map((dependency) => (
              <div key={dependency.name} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-sm text-text-secondary">{dependency.name}</dt>
                <dd className="flex items-center gap-2">
                  <span className="font-mono text-xs text-text-muted">
                    {Math.round(dependency.durationMs)} ms
                  </span>
                  <StatusBadge tone={toneForStatus(dependency.status)}>
                    {statusLabel(dependency.status)}
                  </StatusBadge>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-text-muted">
            Version {readiness.data.version} · server time {readiness.data.serverTime}
          </p>
        </>
      ) : null}

      <Button
        variant="secondary"
        onClick={() => void readiness.refetch()}
        disabled={readiness.isFetching}
      >
        {readiness.isFetching ? 'Checking…' : 'Check again'}
      </Button>
    </Panel>
  );
}

function statusLabel(status: ReadinessResponse['status']): string {
  if (status === 'ok') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  return 'Unavailable';
}
