import { Global, Module } from '@nestjs/common';
import { loadApiEnv, type ApiEnv } from '@eternal-forge/config/server';

/**
 * Injection token for the validated process environment.
 *
 * Nothing in the application reads `process.env` directly; configuration enters
 * through this single, schema-validated value.
 */
export const API_ENV = Symbol('API_ENV');

/**
 * Release identifier, provided separately so services that only need to report
 * a version do not take a dependency on the whole environment.
 */
export const SERVICE_VERSION = Symbol('SERVICE_VERSION');

@Global()
@Module({
  providers: [
    {
      provide: API_ENV,
      // Validation happens during module instantiation, so a misconfigured
      // deployment fails at startup rather than on the first request.
      useFactory: (): ApiEnv => loadApiEnv(),
    },
    {
      provide: SERVICE_VERSION,
      useFactory: (env: ApiEnv): string => env.SERVICE_VERSION,
      inject: [API_ENV],
    },
  ],
  exports: [API_ENV, SERVICE_VERSION],
})
export class ApiConfigModule {}
