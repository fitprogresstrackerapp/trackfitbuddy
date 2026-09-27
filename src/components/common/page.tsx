import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Vertical rhythm container for a routed page. Width is controlled by the layout. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-8 pb-8', className)}>{children}</div>
}

interface PageHeaderProps {
  title: string
  /** Monospace metadata above the title, e.g. "MON 21 SEP" or "CYCLE 03". */
  eyebrow?: string
  actions?: ReactNode
}

export function PageHeader({ title, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0 space-y-1">
        {eyebrow && <p className="label-mono text-muted-foreground">{eyebrow}</p>}
        <h1 className="truncate metric text-3xl text-foreground uppercase lg:text-4xl">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

interface SectionProps {
  title?: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}

/** A titled block separated by spacing — prefer this over generic cards. */
export function Section({ title, meta, children, className }: SectionProps) {
  const hasHeading = Boolean(title) || Boolean(meta)
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      {hasHeading && (
        <div className="flex items-center justify-between gap-4">
          {title && <h2 className="label-section text-foreground-secondary">{title}</h2>}
          {meta && <div className="label-mono text-muted-foreground">{meta}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
