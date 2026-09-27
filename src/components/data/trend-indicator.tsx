import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'

import { formatNumber, NO_VALUE } from '@/lib/format'
import { cn } from '@/lib/utils'

interface TrendIndicatorProps {
  /** Change over the period; `null` = not enough data. */
  delta: number | null
  unit?: string
  fractionDigits?: number
  /**
   * Which direction is favourable for this user and metric (e.g. "down" for
   * weight during fat loss). Omit to show the change without judgement.
   */
  favorable?: 'up' | 'down'
  className?: string
}

/** Direction + magnitude of change, e.g. ↘ −0.8 KG. */
export function TrendIndicator({
  delta,
  unit,
  fractionDigits = 1,
  favorable,
  className,
}: TrendIndicatorProps) {
  if (delta === null) {
    return (
      <span className={cn('label-mono text-muted-foreground', className)}>
        <span aria-hidden="true">{NO_VALUE}</span>
        <span className="sr-only">No trend data</span>
      </span>
    )
  }

  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const Icon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight
  const magnitude = formatNumber(Math.abs(delta), fractionDigits)
  const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : '±'
  const words = { up: 'Up', down: 'Down', flat: 'No change' }[direction]

  const tone =
    direction === 'flat' || !favorable
      ? 'text-foreground-secondary'
      : direction === favorable
        ? 'text-primary'
        : 'text-warning'

  return (
    <span className={cn('inline-flex items-center gap-1 label-mono', tone, className)}>
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      <span aria-hidden="true">
        {sign}
        {magnitude}
        {unit ? ` ${unit}` : ''}
      </span>
      <span className="sr-only">
        {words} {direction === 'flat' ? '' : `${magnitude}${unit ? ` ${unit}` : ''}`}
      </span>
    </span>
  )
}
