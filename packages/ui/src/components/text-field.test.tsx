import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './text-field';

describe('TextField', () => {
  it('associates the visible label with the input', () => {
    render(<TextField label="Email" type="email" />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
  });

  it('marks the input invalid and describes it with the error', () => {
    render(<TextField label="Display name" hint="3–24 characters" error="Too short" />);

    const input = screen.getByLabelText('Display name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('3–24 characters Too short');
  });

  it('is not marked invalid without an error', () => {
    render(<TextField label="Email" />);

    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });
});
