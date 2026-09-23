import { isAuthError } from '@supabase/supabase-js';

/**
 * Turns a Supabase Auth failure into a sentence a player can act on.
 *
 * Raw provider messages are never shown: they vary between versions and can
 * reveal more than intended (docs/UI_SYSTEM.md — "Error UX").
 */
export function describeAuthError(error: unknown): string {
  if (!isAuthError(error)) {
    return 'Something went wrong. Please try again.';
  }

  switch (error.code) {
    case 'invalid_credentials':
      return 'That email and password do not match an account.';
    case 'email_not_confirmed':
      return 'Please confirm your email address first, then sign in.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Try signing in instead.';
    case 'weak_password':
      return 'Choose a stronger password.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'signup_disabled':
      return 'New registrations are currently closed.';
    case 'validation_failed':
      return 'Please check the email address and try again.';
    default:
      return error.status === 0 || error.status === undefined
        ? 'The sign-in service could not be reached. Check your connection and try again.'
        : 'Something went wrong. Please try again.';
  }
}
