import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it('announces danger immediately', () => {
    render(<Alert tone="danger">Could not sign in.</Alert>);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not sign in.');
  });

  it('announces informational messages politely', () => {
    render(<Alert tone="info">You have been signed out.</Alert>);

    expect(screen.getByRole('status')).toHaveTextContent('You have been signed out.');
  });
});
