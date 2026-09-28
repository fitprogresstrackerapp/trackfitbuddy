import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/*
 * Small building blocks shared by the Progress sections. Values are text
 * prepared by the caller, so "—" and "No data" are explicit, never 0.
 */

interface FigureProps {
  label: string
  icon?: LucideIcon
  value: ReactNode
  detail?: ReactNode
  className?: string
}

/** One labelled figure: LABEL / value / detail. */
export function Figure({ label, icon: Icon, value, detail, className }: FigureProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <dt className="flex items-center gap-1.5">
        {Icon && <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        <span className="label-mono text-muted-foreground">{label}</span>
      </dt>
      <dd className="flex flex-col gap-1">
        <span className="metric text-2xl break-words text-foreground tabular-nums">{value}</span>
        {detail && <span className="text-xs text-foreground-secondary">{detail}</span>}
      </dd>
    </div>
  )
}

/** A ruled grid of figures that wraps on narrow screens. */
export function FigureGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-6 gap-y-5 rounded-md border border-border p-4',
        className,
      )}
    >
      {children}
    </dl>
  )
}

/** Compact "no data" note inside a section (spec §38). */
export function NoData({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-border px-4 py-3">
      <p className="label-section text-foreground-secondary">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export function SectionSkeleton({ chart = true }: { chart?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
      {chart && <Skeleton className="h-52 w-full" />}
    </div>
  )
}

/** Sub-heading inside a section: "CALORIES VS TARGET". */
export function SubHeading({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="label-section text-foreground-secondary">{children}</h3>
      {meta && <span className="label-mono text-muted-foreground">{meta}</span>}
    </div>
  )
}
