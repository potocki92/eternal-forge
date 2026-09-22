import { NextResponse } from 'next/server';

/**
 * Liveness probe for the web application itself.
 *
 * Deliberately independent of the API: a platform health check must report on
 * this deployment, not on a service it happens to call.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'ok', service: 'eternal-forge-web', serverTime: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
