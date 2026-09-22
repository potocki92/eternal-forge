import { describe, expect, it } from 'vitest';
import { parsePublicEnv, publicEnvSchema, supabasePublicEnvSchema } from './client.js';

describe('publicEnvSchema', () => {
  it('defaults the API URL for local development', () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
  });

  it('defaults Supabase to the local auth test double', () => {
    expect(parsePublicEnv({})).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-development-anon-key',
    });
  });

  it('rejects a malformed API URL', () => {
    expect(publicEnvSchema.safeParse({ NEXT_PUBLIC_API_URL: 'localhost:3001' }).success).toBe(
      false,
    );
  });

  it('only exposes NEXT_PUBLIC_ variables', () => {
    for (const key of Object.keys(publicEnvSchema.shape)) {
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
    }
    for (const key of Object.keys(supabasePublicEnvSchema.shape)) {
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
    }
  });
});
