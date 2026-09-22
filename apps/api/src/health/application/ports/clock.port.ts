/**
 * Application port for reading the current time.
 *
 * Server time is authoritative (docs/SECURITY.md — "Offline progress"), and
 * injecting it keeps every time-dependent behaviour testable without freezing
 * the global clock.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

/** The system clock. The only implementation that reads the ambient time. */
export const systemClock: Clock = { now: () => new Date() };
