import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-(--radius-pill) px-2.5 py-1 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-elevated text-text-secondary',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusBadgeVariants>;

/**
 * Compact state indicator.
 *
 * Colour alone never carries the meaning: the badge always renders its label as
 * text (docs/UI_SYSTEM.md — "Accessibility").
 */
export function StatusBadge({ className, tone, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)} {...props}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export { statusBadgeVariants };
