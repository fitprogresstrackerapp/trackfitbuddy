import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Page composition primitives. A page reads top-down:
 *   PageHeader → Section (label + rule) → blocks → actions
 * Prefer Sections with rules over wrapping everything in Panels.
 */

/** Vertical rhythm for a routed page. Width is controlled by the layout. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-10 pb-10', className)}>{children}</div>
}

interface PageHeaderProps {
  title: string
  /** Monospace metadata above the title, e.g. "MON 21 SEP" or "CYCLE 03". */
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 space-y-2">
        {eyebrow && <p className="label-mono text-muted-foreground">{eyebrow}</p>}
        <h1 className="heading-page break-words text-foreground">{title}</h1>
        {description && (
          <p className="max-w-prose text-sm text-foreground-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

interface SectionProps {
  title: string
  /** Right-aligned monospace metadata, e.g. "SEP 21" or "4 / 5". */
  meta?: ReactNode
  /** Right-aligned control (link, segmented control…). */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * A labelled group separated by a rule:
 *   TODAY'S NUTRITION ─────────────── SEP 21
 */
export function Section({ title, meta, action, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-5', className)}>
      <div className="flex min-h-7 items-center gap-4 border-b border-border pb-2.5">
        <h2 className="shrink-0 label-section whitespace-nowrap text-foreground-secondary">
          {title}
        </h2>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {meta && <span className="truncate label-mono text-muted-foreground">{meta}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

interface PanelProps {
  children: ReactNode
  title?: string
  meta?: ReactNode
  action?: ReactNode
  /**
   * surface — raised block for grouped data (default)
   * outline — border only, same ground as the page
   * accent  — highlighted block for the one thing that matters most
   */
  variant?: 'surface' | 'outline' | 'accent'
  padding?: 'none' | 'md'
  className?: string
}

/** A bounded block. Use when a group needs its own ground, not by default. */
export function Panel({
  children,
  title,
  meta,
  action,
  variant = 'surface',
  padding = 'md',
  className,
}: PanelProps) {
  const hasHeader = Boolean(title) || Boolean(meta) || Boolean(action)
  return (
    <div
      className={cn(
        'rounded-md border',
        variant === 'surface' && 'border-border bg-surface-1',
        variant === 'outline' && 'border-border',
        variant === 'accent' && 'border-primary/30 bg-primary-surface',
        className,
      )}
    >
      {hasHeader && (
        <div className="flex min-h-11 items-center gap-3 border-b border-border px-4">
          {title && <h3 className="heading-block text-foreground">{title}</h3>}
          <div className="ml-auto flex items-center gap-3">
            {meta && <span className="label-mono text-muted-foreground">{meta}</span>}
            {action}
          </div>
        </div>
      )}
      <div className={cn(padding === 'md' && 'p-4')}>{children}</div>
    </div>
  )
}

interface DividerProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical'
}

export function Divider({ orientation = 'horizontal', className, ...props }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
      {...props}
    />
  )
}
