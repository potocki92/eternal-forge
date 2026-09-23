import { describe, expect, it } from 'vitest';
import { playerNameSchema } from './player-name.js';

describe('playerNameSchema', () => {
  it.each([
    'Kael',
    'Aëlith',
    'Łucja',
    'Ser Duncan',
    "O'Brien",
    'x_x-9',
    'Смерть',
    '鍛冶師匠',
    'abc',
  ])('accepts %j', (name) => {
    expect(playerNameSchema.parse(name)).toBe(name);
  });

  it('trims surrounding whitespace', () => {
    expect(playerNameSchema.parse('  Kael  ')).toBe('Kael');
  });

  it('normalises to NFC so visually identical names are stored identically', () => {
    const decomposed = 'Aëlith';

    expect(playerNameSchema.parse(decomposed)).toBe('Aëlith');
  });

  it('counts code points, not UTF-16 units', () => {
    // Three astral-plane (Deseret) letters: six UTF-16 units, three characters.
    expect(playerNameSchema.safeParse('𐐀𐐁𐐂').success).toBe(true);
    expect(playerNameSchema.safeParse('𐐀'.repeat(25)).success).toBe(false);
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(25)],
    ['empty after trimming', '   '],
    ['double space', 'Ser  Duncan'],
    ['leading separator', '-Kael'],
    ['trailing separator', 'Kael.'],
    ['control character', 'Ka\u0000el'],
    ['zero-width space', 'Ka​el'],
    ['markup', '<script>'],
    ['newline', 'Ka\nel'],
    ['emoji', 'Kael🔥'],
  ])('rejects %s', (_label, name) => {
    expect(playerNameSchema.safeParse(name).success).toBe(false);
  });

  it('bounds the input before doing any work', () => {
    expect(playerNameSchema.safeParse(' '.repeat(10_000)).success).toBe(false);
  });
});
