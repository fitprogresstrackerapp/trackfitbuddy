import type { ReactNode } from 'react'

import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** A labelled list of details: LABEL — value. Missing values read "Not set" or "—". */
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('-mt-2 divide-y divide-border border-b border-border', className)}>
      {children}
    </dl>
  )
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words text-foreground">{children}</dd>
    </div>
  )
}

export function NotSet({ children = 'Not set' }: { children?: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

interface EditSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eyebrow: string
  title: string
  description?: string
  children: ReactNode
}

/** Editing lives in a sheet: bottom sheet on mobile, side panel from md. */
export function EditSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  children,
}: EditSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <SheetHeader eyebrow={eyebrow} title={title} {...(description ? { description } : {})} />
          {children}
        </SheetContent>
      )}
    </Sheet>
  )
}
