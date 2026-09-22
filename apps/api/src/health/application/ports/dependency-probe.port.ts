/**
 * Application port for a backing-service connectivity check.
 *
 * The application layer knows only that a dependency can be probed; which client
 * performs the probe is an infrastructure concern.
 */
export interface DependencyProbe {
  /** Stable identifier reported to operators, e.g. `postgres`. */
  readonly name: string;

  /** Resolves when the dependency answered. Rejects with the driver error. */
  check(): Promise<void>;
}

/** Injection token for the set of probes a readiness check must run. */
export const DEPENDENCY_PROBES = Symbol('DEPENDENCY_PROBES');
