import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('lets a caller override a component default', () => {
    expect(cn('p-4 bg-surface', 'p-8')).toBe('bg-surface p-8');
  });

  it('drops falsy values', () => {
    expect(cn('p-4', false, undefined, null, 'gap-2')).toBe('p-4 gap-2');
  });
});
