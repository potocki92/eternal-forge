'use client';

import {
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_NAME_MIN_LENGTH,
  provisionPlayerRequestSchema,
} from '@eternal-forge/contracts';
import { Alert, Button, Panel, TextField } from '@eternal-forge/ui';
import { useState, type SubmitEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { formText } from '@/lib/form-data';
import { useProvisionPlayer } from './use-player';

type Field = 'displayName' | 'characterName';
type FieldErrors = Partial<Record<Field, string>>;

const NAME_HINT = `${PLAYER_NAME_MIN_LENGTH}–${PLAYER_NAME_MAX_LENGTH} letters or digits; single spaces, hyphens, underscores, apostrophes or periods between them.`;

/**
 * First-run onboarding: name the profile and the main character.
 *
 * Validated with the same shared schema the API applies, so the player sees
 * the real rule before submitting; the API remains the authority. There is
 * deliberately no native `maxLength`: it counts UTF-16 units before trimming,
 * so it would block valid names (surrounding spaces, astral-plane scripts)
 * that the rule — code points after NFC and trimming — accepts.
 */
export function CreatePlayerForm() {
  const provision = useProvisionPlayer();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const request = {
      displayName: formText(form, 'displayName'),
      characterName: formText(form, 'characterName'),
    };

    const parsed = provisionPlayerRequestSchema.safeParse(request);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      return;
    }

    setFieldErrors({});
    provision.mutate(parsed.data);
  }

  const serverError = provision.error;
  const serverMessage =
    serverError === null
      ? undefined
      : serverError instanceof ApiError
        ? serverError.message
        : 'Something went wrong. Please try again.';

  return (
    <Panel as="section" aria-labelledby="create-player-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="create-player-heading" className="font-display text-2xl text-text-primary">
          Name your hero
        </h2>
        <p className="text-sm text-text-secondary">
          Your display name is how other players will see you. Your hero carries their own name.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {serverMessage === undefined ? null : <Alert tone="danger">{serverMessage}</Alert>}
        <TextField
          label="Display name"
          name="displayName"
          autoComplete="nickname"
          hint={NAME_HINT}
          error={fieldErrors.displayName}
          disabled={provision.isPending}
          required
        />
        <TextField
          label="Hero name"
          name="characterName"
          autoComplete="off"
          error={fieldErrors.characterName}
          disabled={provision.isPending}
          required
        />
        <Button type="submit" size="lg" fullWidth disabled={provision.isPending}>
          {provision.isPending ? 'Forging your hero…' : 'Begin'}
        </Button>
      </form>
    </Panel>
  );
}

function toFieldErrors(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if ((field === 'displayName' || field === 'characterName') && errors[field] === undefined) {
      errors[field] = `This name ${issue.message}.`;
    }
  }
  return errors;
}
