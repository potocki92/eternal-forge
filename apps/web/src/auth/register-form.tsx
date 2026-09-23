'use client';

import { Alert, Button, TextField } from '@eternal-forge/ui';
import { useState, type SubmitEvent } from 'react';
import { formText } from '@/lib/form-data';
import { useAuth } from './auth-provider';

/** Supabase's default minimum; the provider enforces its own configured policy. */
const MIN_PASSWORD_LENGTH = 8;

export function RegisterForm() {
  const { signUp } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmEmail, setConfirmEmail] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = formText(form, 'email');
    const password = formText(form, 'password');

    setError(undefined);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setPasswordError(undefined);
    setPending(true);

    const result = await signUp(email, password);

    if (!result.ok) {
      setError(result.message);
      setPending(false);
    } else if ('confirmEmail' in result) {
      setConfirmEmail(true);
      setPending(false);
    }
    // Otherwise the new session signs the player in and GuestOnly navigates on.
  }

  if (confirmEmail) {
    return (
      <Alert tone="success">
        Check your inbox: we sent a link to confirm your email address. Once confirmed, sign in to
        create your hero.
      </Alert>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
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
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={passwordError}
        required
        minLength={MIN_PASSWORD_LENGTH}
        disabled={pending}
      />
      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
