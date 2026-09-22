import { describe, expect, it } from 'vitest';
import { extractBearerToken } from './bearer-token.js';

const token = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';

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
