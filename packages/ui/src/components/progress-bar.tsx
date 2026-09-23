import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

const trackVariants = cva(
  'relative w-full overflow-hidden rounded-(--radius-pill) bg-surface-elevated ring-1 ring-border',
  {
    variants: {
      size: {
        sm: 'h-1.5',
        md: 'h-2.5',
        lg: 'h-3.5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

const fillVariants = cva(
  [
    'h-full rounded-(--radius-pill)',
    'transition-[width] duration-(--duration-normal) ease-(--ease-emphasis)',
    'motion-reduce:transition-none',
  ].join(' '),
  {
    variants: {
      tone: {
        primary: 'bg-primary',
        success: 'bg-success',
        danger: 'bg-danger',
        info: 'bg-info',
      },
    },
    defaultVariants: { tone: 'primary' },
  },
);

export type ProgressBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> &
  VariantProps<typeof trackVariants> &
  VariantProps<typeof fillVariants> & {
    /** Fraction complete, 0 to 1. Values outside are clamped. */
    readonly value: number;
    /** Accessible name, e.g. "Hero health". Required: a bar alone says nothing. */
    readonly label: string;
    /** Spoken value, e.g. "30 of 40". Defaults to a percentage. */
    readonly valueText?: string;
  };

/**
 * A horizontal bar for health, experience and other progress.
 *
 * Exposed as an ARIA `progressbar` with a name and a value text, so the value
 * never depends on seeing the colour or the width (docs/UI_SYSTEM.md —
 * "Accessibility"). Width changes animate unless the player prefers reduced
 * motion.
 */
export function ProgressBar({
  value,
  label,
  valueText,
  tone,
  size,
  className,
  ...props
}: ProgressBarProps) {
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText ?? `${String(percent)}%`}
      className={cn(trackVariants({ size }), className)}
      {...props}
    >
      <div className={fillVariants({ tone })} style={{ width: `${String(fraction * 100)}%` }} />
    </div>
  );
}

export { fillVariants as progressBarFillVariants };
