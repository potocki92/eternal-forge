import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * Placeholder for content that is loading. Purely decorative: the surrounding
 * region states the loading condition in text (e.g. `aria-busy` plus a label).
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-(--radius-control) bg-surface-elevated motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
