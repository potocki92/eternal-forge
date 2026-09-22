import { describe, expect, it } from 'vitest';
import { csvList, port, secret, urlWithProtocol } from './primitives.js';

describe('urlWithProtocol', () => {
  const postgres = urlWithProtocol(['postgres:', 'postgresql:'], 'PostgreSQL');

  it.each([
    'postgresql://user:pw@localhost:5432/db',
    'postgres://user:pw@db.example.com:6543/postgres?pgbouncer=true',
  ])('accepts %s', (value) => {
    expect(postgres.safeParse(value).success).toBe(true);
  });

  it.each(['redis://localhost:6379', 'not-a-url', 'https://example.com'])('rejects %s', (value) => {
    expect(postgres.safeParse(value).success).toBe(false);
  });
});

describe('csvList', () => {
  it('splits, trims and drops empty entries', () => {
    expect(csvList.parse('http://a.test, http://b.test ,, ')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('yields an empty list for an empty string', () => {
    expect(csvList.parse('')).toEqual([]);
  });
});

describe('port', () => {
  it('applies the default when unset', () => {
    expect(port(3001).parse(undefined)).toBe(3001);
  });

  it('coerces a numeric string', () => {
    expect(port(3001).parse('8080')).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '80.5'])('rejects %s', (value) => {
    expect(port(3001).safeParse(value).success).toBe(false);
  });
});

describe('secret', () => {
  it('rejects values below the minimum length', () => {
    expect(secret(16).safeParse('short').success).toBe(false);
    expect(secret(16).safeParse('0123456789abcdef').success).toBe(true);
  });
});
