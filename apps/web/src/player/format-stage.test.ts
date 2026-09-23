import { describe, expect, it } from 'vitest';
import { formatStage } from './format-stage';

describe('formatStage', () => {
  it.each([
    ['1', '1'],
    ['1234567', '1,234,567'],
    // Above 2^53, where Number('9007199254740993') would read 9007199254740992.
    ['9007199254740993', '9,007,199,254,740,993'],
    ['9223372036854775807', '9,223,372,036,854,775,807'],
  ])('formats %s exactly as %s', (stage, expected) => {
    expect(formatStage(stage)).toBe(expected);
  });
});
