import {
  Check,
  CircleDashed,
  CircleDot,
  Clock,
  Gauge,
  Lock,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export type Status =
  'active' | 'completed' | 'pending' | 'failed' | 'locked' | 'incomplete' | 'on-track' | 'warning'

type Tone = 'positive' | 'neutral' | 'muted' | 'warning' | 'negative'

const STATUSES: Record<Status, { label: string; icon: LucideIcon; tone: Tone }> = {
  active: { label: 'Active', icon: CircleDot, tone: 'positive' },
  completed: { label: 'Completed', icon: Check, tone: 'positive' },
  'on-track': { label: 'On track', icon: Gauge, tone: 'positive' },
  pending: { label: 'Pending', icon: Clock, tone: 'neutral' },
  locked: { label: 'Locked', icon: Lock, tone: 'muted' },
  incomplete: { label: 'Incomplete', icon: CircleDashed, tone: 'warning' },
  warning: { label: 'Warning', icon: TriangleAlert, tone: 'warning' },
  failed: { label: 'Failed', icon: X, tone: 'negative' },
}

const tones: Record<Tone, string> = {
  positive: 'border-primary/35 text-primary',
  neutral: 'border-border text-foreground-secondary',
  muted: 'border-border text-muted-foreground',
  warning: 'border-warning/40 text-warning',
  negative: 'border-destructive/40 text-destructive',
}

interface StatusBadgeProps {
  status: Status
  /** Override the default label, e.g. "Synced" for an active state. */
  label?: string
  className?: string
}

/** Small status tag: icon + text (never colour alone). */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const config = STATUSES[status]
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-xs border px-2 label-mono',
        tones[config.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
      {label ?? config.label}
    </span>
  )
}
