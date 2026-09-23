import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: ReactNode;
  /** Persistent guidance below the input. */
  readonly hint?: ReactNode;
  /** Validation message. Marks the input invalid and is announced to assistive tech. */
  readonly error?: ReactNode;
}

/**
 * Labelled single-line input with hint and error text.
 *
 * The label is always visible (no placeholder-as-label), the error is tied to
 * the input through `aria-describedby`, and the control keeps the 44px touch
 * target used by `Button` (docs/UI_SYSTEM.md — "Touch", "Accessibility").
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...props },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? undefined : hintId, error === undefined ? undefined : errorId]
      .filter((value) => value !== undefined)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy}
        className={cn(
          'h-11 w-full rounded-(--radius-control) border bg-surface-elevated px-3 text-base text-text-primary',
          'placeholder:text-text-muted',
          'transition-colors duration-(--duration-fast) ease-(--ease-emphasis)',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:opacity-50',
          error === undefined ? 'border-border hover:border-border-strong' : 'border-danger',
        )}
        {...props}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
