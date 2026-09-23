import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CreatePlayerForm } from './create-player-form';

const mutate = vi.fn();

vi.mock('./use-player', () => ({
  useProvisionPlayer: () => ({ mutate, isPending: false, error: null }),
}));

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function submit(displayName: string, characterName: string) {
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText('Hero name'), { target: { value: characterName } });
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
}

describe('CreatePlayerForm', () => {
  it('imposes no native length cap that disagrees with the shared rule', () => {
    render(<CreatePlayerForm />, { wrapper });

    expect(screen.getByLabelText('Display name')).not.toHaveAttribute('maxlength');
    expect(screen.getByLabelText('Hero name')).not.toHaveAttribute('maxlength');
  });

  it('accepts a 24-character name typed with surrounding spaces, sending it normalised', () => {
    mutate.mockClear();
    render(<CreatePlayerForm />, { wrapper });

    submit(`  ${'a'.repeat(24)}  `, 'Ember');

    expect(mutate).toHaveBeenCalledWith({ displayName: 'a'.repeat(24), characterName: 'Ember' });
  });

  it('accepts 24 astral-plane letters (48 UTF-16 units)', () => {
    mutate.mockClear();
    render(<CreatePlayerForm />, { wrapper });

    submit('Kael', '𐐀'.repeat(24));

    expect(mutate).toHaveBeenCalledWith({ displayName: 'Kael', characterName: '𐐀'.repeat(24) });
  });

  it('still rejects 25 characters, before anything is sent', () => {
    mutate.mockClear();
    render(<CreatePlayerForm />, { wrapper });

    submit('a'.repeat(25), 'Ember');

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true');
  });
});
