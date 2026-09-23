import Link from 'next/link';
import type { ReactNode } from 'react';
import { Panel } from '@eternal-forge/ui';

/** Shared frame for the sign-in and registration screens. Mobile-first, one column. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-xs font-medium tracking-[0.2em] text-text-muted uppercase hover:text-text-secondary"
        >
          Eternal Forge
        </Link>
        <h1 className="font-display text-3xl text-text-primary">{title}</h1>
        <p className="text-sm text-text-secondary">{description}</p>
      </header>
      <Panel as="section" aria-label={title} className="flex flex-col gap-4">
        {children}
      </Panel>
      <p className="text-center text-sm text-text-secondary">{footer}</p>
    </main>
  );
}

export const inlineLinkClass =
  'font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
