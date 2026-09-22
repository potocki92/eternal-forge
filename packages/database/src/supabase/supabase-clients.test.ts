import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseAdminClient, createSupabasePublicClient } from './supabase-clients.js';

const url = 'https://project.supabase.co';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSupabaseAdminClient', () => {
  it('builds a client for a server process', () => {
    expect(createSupabaseAdminClient({ url, serviceRoleKey: 'service-role-key-value' })).toBeTypeOf(
      'object',
    );
  });

  it('refuses to construct a privileged client in a browser', () => {
    vi.stubGlobal('window', {});

    expect(() =>
      createSupabaseAdminClient({ url, serviceRoleKey: 'service-role-key-value' }),
    ).toThrow(/never be constructed in a browser/u);
  });
});

describe('createSupabasePublicClient', () => {
  it('builds a client usable from a browser', () => {
    vi.stubGlobal('window', {});

    expect(createSupabasePublicClient({ url, anonKey: 'anon-key-value' })).toBeTypeOf('object');
  });
});
