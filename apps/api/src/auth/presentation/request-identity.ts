import type { Request } from 'express';
import type { AuthenticatedIdentity } from '../application/authenticated-identity.js';

/**
 * Identity attached to a request by {@link AuthGuard}.
 *
 * A WeakMap keyed by the request object rather than a property on it: nothing a
 * client sends can populate it, it needs no global type augmentation, and it is
 * released together with the request.
 */
const identities = new WeakMap<Request, AuthenticatedIdentity>();

export function setRequestIdentity(request: Request, identity: AuthenticatedIdentity): void {
  identities.set(request, identity);
}

export function getRequestIdentity(request: Request): AuthenticatedIdentity | undefined {
  return identities.get(request);
}
