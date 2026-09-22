/**
 * Raised when process environment does not satisfy a schema.
 *
 * The message deliberately contains variable *names* and validation messages
 * only. Environment values are secrets (see docs/SECURITY.md) and must never
 * reach logs or error reporting.
 */
export class EnvValidationError extends Error {
  public readonly issues: readonly EnvIssue[];

  public readonly context: string;

  constructor(context: string, issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join('\n');
    super(`Invalid environment for "${context}":\n${lines}`);
    this.name = 'EnvValidationError';
    this.context = context;
    this.issues = issues;
  }
}

export interface EnvIssue {
  /** Name of the offending environment variable, e.g. `DATABASE_URL`. */
  readonly variable: string;
  /** Human readable reason. Never contains the value. */
  readonly message: string;
}
