import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/**
 * Opts a controller or route out of authentication.
 *
 * Every route requires a verified access token unless it carries this marker,
 * so a new endpoint is protected by default (ADR-016).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
