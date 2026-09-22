/**
 * Reusable application UI.
 *
 * This package owns presentation primitives only. It contains no gameplay rules
 * and never talks to the API (CLAUDE.md — "packages/ui").
 */
export { Button, buttonVariants } from './components/button';
export type { ButtonProps } from './components/button';
export { Panel } from './components/panel';
export type { PanelProps } from './components/panel';
export { StatusBadge, statusBadgeVariants } from './components/status-badge';
export type { StatusBadgeProps } from './components/status-badge';
export { cn } from './lib/cn';
