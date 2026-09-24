/**
 * Machine-readable reasons a Game Core operation can refuse its input.
 *
 * Game Core never returns a partially valid result: invalid input is rejected
 * with one of these codes so callers (the API, the worker) can translate it
 * into their own error model without parsing a message.
 */
export type GameCoreErrorCode =
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'OVERFLOW'
  | 'DIVISION_BY_ZERO'
  | 'NEGATIVE_VALUE'
  | 'NOT_A_SAFE_INTEGER'
  | 'INVALID_ARGUMENT'
  /** A stage the character has not reached was requested (ADR-021). */
  | 'STAGE_LOCKED'
  /** A bounded computation would exceed its hard work limit (ADR-023). */
  | 'LIMIT_EXCEEDED'
  /** A catalog has no definition for a supplied stable item identity. */
  | 'UNKNOWN_ITEM_DEFINITION'
  /** Static item content attempted to reuse an existing stable identity. */
  | 'DUPLICATE_ITEM_DEFINITION'
  | 'UNSUPPORTED_RULES_VERSION';

export class GameCoreError extends Error {
  public readonly code: GameCoreErrorCode;

  public constructor(code: GameCoreErrorCode, message: string) {
    super(message);
    this.name = 'GameCoreError';
    this.code = code;
  }
}
