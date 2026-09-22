import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /**
   * Element to render. Use `section` or `article` when the panel is a landmark
   * in the page outline rather than a plain grouping box.
   */
  readonly as?: 'div' | 'section' | 'article';
}

/**
 * Standard content surface: a bordered, elevated container used for grouping
 * related information on every screen.
 */
export function Panel({ as: Component = 'div', className, ...props }: PanelProps) {
  return (
    <Component
      className={cn(
        'rounded-(--radius-panel) border border-border bg-surface p-4 shadow-(--shadow-panel)',
        className,
      )}
      {...props}
    />
  );
}
