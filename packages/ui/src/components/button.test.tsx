import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Forge</Button>);

    expect(screen.getByRole('button', { name: 'Forge' })).toHaveAttribute('type', 'button');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="danger" size="lg">
        Reset
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Reset' });
    expect(button.className).toContain('bg-danger');
    expect(button.className).toContain('h-12');
  });

  it('lets a caller override styling through className', () => {
    render(<Button className="w-full">Claim</Button>);

    expect(screen.getByRole('button', { name: 'Claim' }).className).toContain('w-full');
  });

  it('honours the disabled attribute', () => {
    render(<Button disabled>Claim</Button>);

    expect(screen.getByRole('button', { name: 'Claim' })).toBeDisabled();
  });
});
