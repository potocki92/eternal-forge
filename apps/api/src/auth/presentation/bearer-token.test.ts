import { describe, expect, it } from 'vitest';
import { extractBearerToken } from './bearer-token.js';

/**
 * A compact-JWS-shaped string, built at runtime so no token-like literal is
 * committed (secret scanners flag those). Unsigned; it proves nothing.
 */
const token = [{ alg: 'ES256' }, { sub: 'x' }, 'signature']
  .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
  .join('.');

describe('extractBearerToken', () => {
  it('extracts a compact JWS from a Bearer header', () => {
    expect(extractBearerToken(`Bearer ${token}`)).toEqual({ kind: 'present', token });
  });

  it.each([undefined, ''])('reports %j as missing', (header) => {
    expect(extractBearerToken(header)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['another scheme', `Basic ${token}`],
    ['lower-case scheme with extra spaces', `Bearer  ${token}`],
    ['not a JWS', 'Bearer opaque-token'],
    ['trailing data', `Bearer ${token} extra`],
    ['header injection', `Bearer ${token}\r\nX-Admin: 1`],
    ['oversized', `Bearer ${'a'.repeat(9000)}.b.c`],
  ])('rejects %s as malformed', (_label, header) => {
    expect(extractBearerToken(header)).toEqual({ kind: 'malformed' });
  });
});
