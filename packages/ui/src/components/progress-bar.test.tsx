import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('exposes its name and value to assistive technology', () => {
    render(<ProgressBar label="Hero health" value={0.75} valueText="75 of 100" />);

    const bar = screen.getByRole('progressbar', { name: 'Hero health' });
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(bar).toHaveAttribute('aria-valuetext', '75 of 100');
  });

  it.each([
    [-1, '0'],
    [2, '100'],
    [Number.NaN, '0'],
  ])('clamps %s to %s%%', (value, expected) => {
    render(<ProgressBar label="Experience" value={value} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
  });
});
