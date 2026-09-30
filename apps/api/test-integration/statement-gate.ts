import pg from 'pg';

interface PendingPause {
  /** 0-based position of the statement to hold. */
  readonly index: number;
  /** Statements issued since the gate was armed. */
  seen: number;
  readonly reached: () => void;
  readonly release: Promise<void>;
}

/**
 * A deterministic interleaving point at the PostgreSQL driver boundary.
 *
 * Prisma runs one repository read as several SQL statements. To prove the
 * read is coherent whatever commits between them, a test must be able to stop
 * it *between two statements*, let a competing write commit, and resume it —
 * at every boundary, not only where a timing race happens to land.
 *
 * The gate wraps `pg.Client.prototype.query`, which every connection of the
 * Prisma `pg` adapter uses (pooled queries and interactive transactions
 * alike). It is inert unless armed: {@link record} lists the statements an
 * operation issues, and {@link pauseBefore} holds the operation's statement
 * number `index` until a competing operation has finished. Nothing is timed;
 * the order is enforced. Integration test files run one at a time, so only
 * the operation under test can issue statements while the gate is armed.
 */
export class StatementGate {
  private readonly original = queryDescriptor();
  private recording: string[] | null = null;
  private pending: PendingPause | null = null;

  install(): void {
    const query: unknown = this.original.value;
    if (typeof query !== 'function')
      throw new Error('pg.Client.prototype.query is not a function.');
    const intercept = (args: readonly unknown[]) => this.intercept(statementText(args[0]));
    Object.defineProperty(pg.Client.prototype, 'query', {
      configurable: true,
      writable: true,
      value: function gatedQuery(this: pg.Client, ...args: unknown[]): unknown {
        const hold = intercept(args);
        if (hold === null) return Reflect.apply(query, this, args);
        const resumed = hold.then((): unknown => Reflect.apply(query, this, args));
        // Callback form (pooled queries) delivers the result to the callback.
        return typeof args.at(-1) === 'function' ? undefined : resumed;
      },
    });
  }

  uninstall(): void {
    Object.defineProperty(pg.Client.prototype, 'query', this.original);
  }

  /** The statements `operation` issues, in order. */
  async record(operation: () => Promise<unknown>): Promise<readonly string[]> {
    const statements: string[] = [];
    this.recording = statements;
    try {
      await operation();
    } finally {
      this.recording = null;
    }
    return statements;
  }

  /**
   * Runs `operation`, holds its statement number `index` (0-based) until
   * `competitor` has completed, then lets it finish and returns its result.
   */
  async pauseBefore<T>(
    index: number,
    operation: () => Promise<T>,
    competitor: () => Promise<void>,
  ): Promise<T> {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      this.pending = { index, seen: 0, reached: resolve, release: released };
    });
    const running = operation();
    // Observed below; this only keeps an early competitor failure from also
    // reporting the abandoned read as an unhandled rejection.
    running.catch(() => undefined);
    try {
      const paused = await Promise.race([reached.then(() => true), running.then(() => false)]);
      if (!paused) throw new Error(`The operation finished before statement ${String(index)}.`);
      await competitor();
    } finally {
      this.pending = null;
      release();
    }
    return running;
  }

  private intercept(text: string | null): Promise<void> | null {
    if (text === null) return null;
    this.recording?.push(text);
    const pending = this.pending;
    if (pending === null) return null;
    const position = pending.seen;
    pending.seen += 1;
    if (position !== pending.index) return null;
    // Disarm before the competitor runs, so its own statements pass through.
    this.pending = null;
    pending.reached();
    return pending.release;
  }
}

function queryDescriptor(): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(pg.Client.prototype, 'query');
  if (descriptor === undefined) throw new Error('pg.Client.prototype.query is missing.');
  return descriptor;
}

function statementText(query: unknown): string | null {
  if (typeof query === 'string') return query;
  if (typeof query === 'object' && query !== null && 'text' in query) {
    return typeof query.text === 'string' ? query.text : null;
  }
  return null;
}
