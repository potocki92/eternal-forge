import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * The single button primitive for the application.
 *
 * New appearances are added as variants, never as new components
 * (docs/UI_SYSTEM.md — "Variants").
 *
 * Sizes keep a minimum 44px touch target at `md` and above; `sm` is reserved for
 * dense desktop affordances that also have a larger mobile equivalent.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-(--radius-control) font-medium',
    'transition-colors duration-(--duration-fast) ease-(--ease-emphasis)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-contrast hover:bg-primary-strong',
        secondary:
          'bg-surface-elevated text-text-primary border border-border hover:border-border-strong',
        danger: 'bg-danger text-text-primary hover:opacity-90',
        ghost:
          'bg-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, fullWidth, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
});

export { buttonVariants };
