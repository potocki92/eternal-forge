import { Skeleton } from '@eternal-forge/ui';

/** A centred, announced pending state for whole-screen transitions. */
export function FullScreenStatus({ label }: { readonly label: string }) {
  return (
    <main
      aria-busy="true"
      className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col justify-center gap-4 px-4 py-10"
    >
      <p role="status" className="text-center text-sm text-text-secondary">
        {label}
      </p>
      <Skeleton className="mx-auto h-2 w-32" />
    </main>
  );
}
