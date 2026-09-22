import { describe, expect, it } from 'vitest';
import { isSafeRequestId, resolveRequestId } from './request-id.middleware.js';

describe('isSafeRequestId', () => {
  it.each(['01JABCDEF0123456789', 'a'.repeat(128), 'req-id_1.2'])('accepts %s', (value) => {
    expect(isSafeRequestId(value)).toBe(true);
  });

  it.each([undefined, '', 'short', 'a'.repeat(129), 'has space', 'inject\nheader', '../etc'])(
    'rejects %j',
    (value) => {
      expect(isSafeRequestId(value)).toBe(false);
    },
  );
});

describe('resolveRequestId', () => {
  it('propagates a safe inbound id so a trace spans web and API', () => {
    expect(resolveRequestId('01JABCDEF0123456789')).toBe('01JABCDEF0123456789');
  });

  it('generates an id when the client supplies none', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('replaces an id that could forge a log line or a header', () => {
    const forged = 'valid-looking\r\nX-Admin: true';

    expect(resolveRequestId(forged)).not.toContain('X-Admin');
  });
});
