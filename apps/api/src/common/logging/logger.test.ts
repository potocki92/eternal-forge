import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { PinoLoggerService } from './logger.js';

function capture(): { readonly service: PinoLoggerService; readonly lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'trace', base: null, timestamp: false }, stream);
  return {
    service: new PinoLoggerService(logger),
    lines: () => chunks.map((chunk): unknown => JSON.parse(chunk)),
  };
}

describe('PinoLoggerService', () => {
  it('logs a text message with its context', () => {
    const { service, lines } = capture();
    service.log('API listening', 'Bootstrap');
    expect(lines()).toEqual([{ level: 30, context: 'Bootstrap', msg: 'API listening' }]);
  });

  it('records a structured event as fields a query can filter on', () => {
    const { service, lines } = capture();
    service.debug(
      { msg: 'Combat refused', event: 'combat.not_ready', characterId: 'c-1', retryAfterMs: 1500 },
      'RunCombatUseCase',
    );
    expect(lines()).toEqual([
      {
        level: 20,
        event: 'combat.not_ready',
        characterId: 'c-1',
        retryAfterMs: 1500,
        context: 'RunCombatUseCase',
        msg: 'Combat refused',
      },
    ]);
  });

  it('never lets an event overwrite the logger’s own context', () => {
    const { service, lines } = capture();
    service.warn({ msg: 'x', context: 'forged' }, 'Real');
    expect(lines()).toEqual([{ level: 40, context: 'Real', msg: 'x' }]);
  });

  it('treats an object without a text `msg` as a plain message', () => {
    const { service, lines } = capture();
    service.log({ note: 'no msg' }, 'Ctx');
    expect(lines()).toEqual([{ level: 30, context: 'Ctx', msg: '[object Object]' }]);
  });
});
