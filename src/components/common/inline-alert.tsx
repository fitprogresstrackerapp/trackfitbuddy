import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface InlineAlertProps {
  tone?: 'error' | 'warning'
  children: ReactNode
  className?: string
}

/** Compact message inside a form or section. Announced to screen readers. */
export function InlineAlert({ tone = 'error', children, className }: InlineAlertProps) {
  const Icon = tone === 'error' ? CircleAlert : TriangleAlert
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm text-foreground',
        tone === 'error'
          ? 'border-destructive/50 bg-destructive/10'
          : 'border-warning/50 bg-warning/10',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'error' ? 'text-destructive' : 'text-warning',
        )}
      />
      <div>{children}</div>
    </div>
  )
}
