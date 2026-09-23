import type { StageNumberDto } from '@eternal-forge/contracts';

const grouped = new Intl.NumberFormat('en-US');

/**
 * Presentation of a stage number received from the API, e.g. `"1234567"` →
 * `"1,234,567"`.
 *
 * The contract has already validated the canonical decimal string, and a
 * `bigint` holds and formats every stage exactly, so nothing is rounded the
 * way a JavaScript `number` would round beyond 2^53. Display only: the client
 * never computes gameplay from a stage.
 */
export function formatStage(stage: StageNumberDto): string {
  return grouped.format(BigInt(stage));
}
