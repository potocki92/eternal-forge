import { describe, expect, it } from 'vitest';
import { assertDeployableEnvironment, deploymentProblems } from './deployment-guard';

const complete = {
  VERCEL: '1',
  NEXT_PUBLIC_API_URL: 'https://api.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
};

describe('deploymentProblems', () => {
  it('accepts local and CI builds, which use the local defaults', () => {
    expect(deploymentProblems({})).toEqual([]);
  });

  it('accepts a complete Vercel build', () => {
    expect(deploymentProblems(complete)).toEqual([]);
  });

  it('refuses a Vercel build that would silently talk to localhost', () => {
    expect(deploymentProblems({ ...complete, NEXT_PUBLIC_API_URL: undefined })).toEqual([
      'NEXT_PUBLIC_API_URL must be set for a Vercel deployment.',
    ]);
    expect(deploymentProblems({ VERCEL: '1' })).toHaveLength(3);
  });

  it.each([
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_JWT_SECRET',
    'NEXT_PUBLIC_DATABASE_URL',
  ])('refuses %s anywhere, even outside Vercel', (name) => {
    expect(deploymentProblems({ [name]: 'value' })).toHaveLength(1);
  });

  it('names variables but never echoes their values', () => {
    expect(() => {
      assertDeployableEnvironment({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_value' });
    }).toThrow(/^(?!.*sb_secret_value)/su);
  });
});
