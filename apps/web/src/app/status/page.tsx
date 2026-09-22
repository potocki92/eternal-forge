import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceStatus } from '@/components/service-status';

export const metadata: Metadata = {
  title: 'System status · Eternal Forge',
};

export default function StatusPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
        >
          ← Eternal Forge
        </Link>
        <h1 className="font-display text-3xl text-text-primary">System status</h1>
        <p className="text-sm text-text-secondary">
          Live readiness of the API and the services it depends on.
        </p>
      </header>

      <ServiceStatus />
    </main>
  );
}
