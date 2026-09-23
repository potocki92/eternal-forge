import { Logger } from '@nestjs/common';

/**
 * Use cases log through Nest's `Logger`. Outside a Nest application it prints
 * to the console, which would bury test output; tests that care about a log
 * event spy on `Logger.prototype` instead.
 */
Logger.overrideLogger(false);
