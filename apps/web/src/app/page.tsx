import Link from 'next/link';
import { Panel, buttonVariants } from '@eternal-forge/ui';

const PILLARS = [
  {
    title: 'Deterministic core',
    body: 'Combat and progression are resolved by a server-authoritative simulation, so results are reproducible and verifiable.',
  },
  {
    title: 'Builds over waiting',
    body: 'A better weapon, three runes and a rethought passive path should out-earn an extra hour of idling.',
  },
  {
    title: 'Many ladders',
    body: 'Stage, tower, boss damage and arena reward different builds. There is no single power score.',
  },
] as const;

export default function StartPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase">
          Early development
        </p>
        <h1 className="font-display text-4xl leading-tight text-text-primary">Eternal Forge</h1>
        <p className="text-base text-text-secondary">
          A browser-first idle action RPG built for years of progression, theorycrafting and
          competition.
        </p>
      </header>

      <nav aria-label="Account" className="flex flex-col gap-3 sm:flex-row">
        <Link href="/register" className={buttonVariants({ size: 'lg', fullWidth: true })}>
          Create account
        </Link>
        <Link
          href="/login"
          className={buttonVariants({ variant: 'secondary', size: 'lg', fullWidth: true })}
        >
          Sign in
        </Link>
      </nav>

      <Panel as="section" aria-labelledby="pillars-heading" className="flex flex-col gap-4">
        <h2 id="pillars-heading" className="text-sm font-semibold text-text-primary">
          What the foundation is for
        </h2>
        <ul className="flex flex-col gap-4">
          {PILLARS.map((pillar) => (
            <li key={pillar.title} className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text-primary">{pillar.title}</span>
              <span className="text-sm text-text-secondary">{pillar.body}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel as="section" aria-labelledby="status-heading" className="flex flex-col gap-3">
        <h2 id="status-heading" className="text-sm font-semibold text-text-primary">
          System status
        </h2>
        <p className="text-sm text-text-secondary">
          Accounts and heroes are live; combat is not yet. The status page reports whether the API
          and its backing services are reachable.
        </p>
        <Link href="/status" className={buttonVariants({ variant: 'ghost' })}>
          Open system status
        </Link>
      </Panel>
    </main>
  );
}
