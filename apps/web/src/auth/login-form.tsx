'use client';

import { Alert, Button, TextField } from '@eternal-forge/ui';
import { useSearchParams } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { formText } from '@/lib/form-data';
import { useAuth } from './auth-provider';

const REASON_MESSAGES: Readonly<Record<string, string>> = {
  expired: 'Your session has expired. Please sign in again.',
  'signed-out': 'You have been signed out.',
};

export function LoginForm() {
  const { signIn } = useAuth();
  const reason = useSearchParams().get('reason');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);

    const result = await signIn(formText(form, 'email'), formText(form, 'password'));

    // On success the auth state changes and GuestOnly navigates to the game.
    if (!result.ok) {
      setError(result.message);
      setPending(false);
    }
  }

  const notice = reason === null ? undefined : REASON_MESSAGES[reason];

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
      {notice === undefined || error !== undefined ? null : <Alert tone="info">{notice}</Alert>}
      {error === undefined ? null : <Alert tone="danger">{error}</Alert>}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        disabled={pending}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={pending}
      />
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
