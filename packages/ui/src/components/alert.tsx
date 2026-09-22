import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

const alertVariants = cva('rounded-(--radius-control) border px-3 py-2.5 text-sm', {
  variants: {
    tone: {
      info: 'border-info/40 bg-info/10 text-text-primary',
      success: 'border-success/40 bg-success/10 text-text-primary',
      warning: 'border-warning/40 bg-warning/10 text-text-primary',
      danger: 'border-danger/40 bg-danger/10 text-text-primary',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

/**
 * Inline message about the outcome of an action.
 *
 * `danger` and `warning` are announced immediately (`role="alert"`); `info` and
 * `success` politely (`role="status"`). Colour is never the only signal: the
 * text carries the meaning.
 */
export function Alert({ className, tone, role, ...props }: AlertProps) {
  const urgent = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={role ?? (urgent ? 'alert' : 'status')}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}

export { alertVariants };
