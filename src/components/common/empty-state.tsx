import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}

/**
 * Compact "nothing here yet" block:
 *   NO RECORDS
 *   Nothing has been logged for this period.
 *   [ Add food ]
 */
export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-md border border-dashed border-border px-5 py-6',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
        <p className="label-section text-foreground">{title}</p>
      </div>
      {description && <p className="text-sm text-foreground-secondary">{description}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
