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

export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-md border border-dashed border-border px-5 py-8',
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-5 text-muted-foreground" />}
      <div className="space-y-1">
        <p className="label-section text-foreground">{title}</p>
        {description && <p className="text-sm text-foreground-secondary">{description}</p>}
      </div>
      {action}
    </div>
  )
}
