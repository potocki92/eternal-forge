import { bench, describe } from 'vitest';
import { HugeNumber } from '../src/index.js';

/**
 * Micro-benchmarks for HugeNumber (ADR-013, section 6).
 *
 *   pnpm --filter @eternal-forge/game-core run bench
 *
 * Not part of `pnpm test` and not run in CI: timings depend on the machine, and
 * a benchmark must never make CI unstable. Results are recorded in
 * docs/ROADMAP.md when a phase completes.
 */

const small = HugeNumber.fromNumber(1_234_567);
const smallOther = HugeNumber.fromNumber(7_654_321);
const wide = HugeNumber.parse('1.23456789012345678e40');
const wideOther = HugeNumber.parse('8.76543210987654321e38');
const huge = HugeNumber.parse('4.56789012345678901e1000000');
const hugeOther = HugeNumber.parse('9.87654321098765432e999990');
const growth = HugeNumber.fromDecimal('1.12');
const wideNeighbour = wide.add(HugeNumber.parse('1e23'));

let sink: HugeNumber = HugeNumber.ZERO;
let order = 0;

describe('HugeNumber add', () => {
  bench('small integers (exact)', () => {
    sink = small.add(smallOther);
  });
  bench('18 digits, overlapping exponents (rounds)', () => {
    sink = wide.add(wideOther);
  });
  bench('exponent 10^6, gap 10 (rounds)', () => {
    sink = huge.add(hugeOther);
  });
});

describe('HugeNumber multiply', () => {
  bench('small integers (exact)', () => {
    sink = small.mul(smallOther);
  });
  bench('18 x 18 digits (rounds)', () => {
    sink = wide.mul(wideOther);
  });
  bench('exponent 10^6', () => {
    sink = huge.mul(growth);
  });
});

describe('HugeNumber compare', () => {
  bench('different exponents', () => {
    order = wide.compare(huge);
  });
  bench('equal exponents', () => {
    order = wide.compare(wideNeighbour);
  });
});

describe('HugeNumber derived operations', () => {
  bench('divide', () => {
    sink = wide.div(wideOther);
  });
  bench('pow(1.12, 100 000) — stage scaling', () => {
    sink = growth.pow(100_000);
  });
  bench('canonical toString + parse', () => {
    sink = HugeNumber.parse(wide.toString());
  });
});

// Keep results observable so the engine cannot discard the work.
export const observed = (): readonly [HugeNumber, number] => [sink, order];
