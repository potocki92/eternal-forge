/**
 * Build-time checks for deployments (docs/DEPLOYMENT.md).
 *
 * `NEXT_PUBLIC_*` values are inlined into the browser bundle when the app is
 * built, and the public configuration falls back to local-development
 * defaults. Two mistakes would therefore ship silently:
 *
 * 1. a Vercel build without its public variables — a deployment that talks to
 *    `localhost`;
 * 2. a privileged key exposed under a `NEXT_PUBLIC_` name — a secret shipped to
 *    every browser (docs/SECURITY.md — "Supabase").
 *
 * Both fail the build instead.
 */

/** Public variables a hosted deployment must set explicitly. */
export const REQUIRED_DEPLOYMENT_VARIABLES = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

const PRIVILEGED_NAME = /SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|DATABASE_URL|DIRECT_URL|JWT/u;

export type EnvironmentSnapshot = Readonly<Record<string, string | undefined>>;

/** Problems that must stop the build, as messages naming variables but never values. */
export function deploymentProblems(env: EnvironmentSnapshot): string[] {
  const problems: string[] = [];

  for (const name of Object.keys(env)) {
    if (name.startsWith('NEXT_PUBLIC_') && PRIVILEGED_NAME.test(name)) {
      problems.push(`${name} looks privileged and must never be exposed to the browser.`);
    }
  }

  // Vercel sets VERCEL=1 on every build it runs.
  if (env.VERCEL === '1') {
    for (const name of REQUIRED_DEPLOYMENT_VARIABLES) {
      if ((env[name] ?? '').trim() === '') {
        problems.push(`${name} must be set for a Vercel deployment.`);
      }
    }
  }

  return problems;
}

export function assertDeployableEnvironment(env: EnvironmentSnapshot): void {
  const problems = deploymentProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to build apps/web:\n- ${problems.join('\n- ')}`);
  }
}
