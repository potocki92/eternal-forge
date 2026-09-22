import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('always communicates state as text, not colour alone', () => {
    render(<StatusBadge tone="danger">Unavailable</StatusBadge>);

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});
