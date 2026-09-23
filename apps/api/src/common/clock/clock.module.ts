import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './clock.port.js';

/** Provides the one ambient-time source every module injects (see {@link CLOCK}). */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
