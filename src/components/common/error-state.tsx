import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'An unexpected error occurred. Try again in a moment.',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-surface-1 px-5 py-6',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <span className="label-mono">Error</span>
      </div>
      <div className="space-y-1">
        <p className="label-section text-foreground">{title}</p>
        <p className="text-sm break-words whitespace-pre-line text-foreground-secondary">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}
