import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Tone = 'error' | 'warning' | 'info' | 'success'

const TONES: Record<Tone, { icon: LucideIcon; box: string; iconColor: string }> = {
  error: {
    icon: CircleAlert,
    box: 'border-destructive/50 bg-destructive/10',
    iconColor: 'text-destructive',
  },
  warning: {
    icon: TriangleAlert,
    box: 'border-warning/50 bg-warning/10',
    iconColor: 'text-warning',
  },
  info: { icon: Info, box: 'border-border bg-surface-1', iconColor: 'text-foreground-secondary' },
  success: {
    icon: CircleCheck,
    box: 'border-primary/40 bg-primary-surface',
    iconColor: 'text-primary',
  },
}

interface InlineAlertProps {
  tone?: Tone
  /** Override the tone icon, e.g. Lock for a locked record. */
  icon?: LucideIcon
  title?: string
  children: ReactNode
  className?: string
}

/**
 * Persistent message inside a page, form or section (validation summary,
 * locked record, incomplete profile). Errors and warnings are announced
 * immediately; info/success politely.
 */
export function InlineAlert({
  tone = 'error',
  icon,
  title,
  children,
  className,
}: InlineAlertProps) {
  const config = TONES[tone]
  const Icon = icon ?? config.icon
  const urgent = tone === 'error' || tone === 'warning'
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-sm border px-3 py-2.5 text-sm text-foreground',
        config.box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', config.iconColor)} />
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && 'text-foreground-secondary')}>{children}</div>
      </div>
    </div>
  )
}
