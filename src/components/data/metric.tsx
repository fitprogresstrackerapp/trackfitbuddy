import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatNumber, NO_VALUE } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ProgressBar, type ProgressTone } from './progress-bar'

const metricSizes = {
  sm: 'text-2xl',
  md: 'text-4xl',
  lg: 'text-5xl',
  xl: 'text-6xl sm:text-7xl',
} as const

interface MetricProps {
  value: number | null
  unit?: string
  fractionDigits?: number
  size?: keyof typeof metricSizes
  className?: string
}

/** A single display number: 1,450 KCAL. `null` renders "—" (no data), never 0. */
export function Metric({ value, unit, fractionDigits = 0, size = 'md', className }: MetricProps) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className={cn('metric text-foreground', metricSizes[size])}>
        {value === null ? (
          <>
            <span aria-hidden="true">{NO_VALUE}</span>
            <span className="sr-only">No data</span>
          </>
        ) : (
          formatNumber(value, fractionDigits)
        )}
      </span>
      {unit && value !== null && <span className="label-mono text-muted-foreground">{unit}</span>}
    </span>
  )
}

interface LabelLineProps {
  label: string
  icon?: LucideIcon | undefined
  meta?: ReactNode
}

function LabelLine({ label, icon: Icon, meta }: LabelLineProps) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
      <span className="label-section text-foreground-secondary">{label}</span>
      {meta && <span className="ml-auto label-mono text-muted-foreground">{meta}</span>}
    </div>
  )
}

interface MetricBlockProps {
  label: string
  icon?: LucideIcon
  value: number | null
  unit?: string
  /** When set, shows "/ target" and (by default) a progress bar. */
  target?: number | null
  fractionDigits?: number
  size?: keyof typeof metricSizes
  meta?: ReactNode
  showProgress?: boolean
  tone?: ProgressTone
  className?: string
}

/**
 * Primary metric with its target:
 *   [icon] CALORIES                     TARGET
 *   1,450 / 2,000 KCAL
 *   ██████████████░░░░░
 */
export function MetricBlock({
  label,
  icon,
  value,
  unit,
  target = null,
  fractionDigits = 0,
  size = 'lg',
  meta,
  showProgress = true,
  tone,
  className,
}: MetricBlockProps) {
  const hasTarget = target !== null
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <LabelLine label={label} icon={icon} meta={meta} />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Metric value={value} fractionDigits={fractionDigits} size={size} />
        <span className="label-mono text-muted-foreground">
          {hasTarget ? `/ ${formatNumber(target, fractionDigits)}` : ''}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      {hasTarget && showProgress && (
        <ProgressBar
          value={value}
          max={target}
          label={label}
          size="md"
          {...(tone ? { tone } : {})}
          valueText={
            value === null
              ? undefined
              : `${formatNumber(value, fractionDigits)} of ${formatNumber(target, fractionDigits)}${unit ? ` ${unit}` : ''}`
          }
        />
      )}
    </div>
  )
}

export interface StatItem {
  label: string
  value: number | null
  unit?: string
  fractionDigits?: number
  icon?: LucideIcon
}

/**
 * A ruled grid of secondary numbers (steps, workouts, activities…). Cells
 * wrap on narrow screens and always fill the row, so no empty cells appear.
 */
export function StatRow({ items, className }: { items: readonly StatItem[]; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-border', className)}>
      <dl className="-mt-px -ml-px flex flex-wrap">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex min-w-[8.5rem] flex-1 flex-col gap-2 border-t border-l border-border p-3.5"
          >
            <dt className="flex items-center gap-1.5">
              {item.icon && (
                <item.icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              <span className="label-mono text-muted-foreground">{item.label}</span>
            </dt>
            <dd>
              <Metric
                value={item.value}
                size="sm"
                fractionDigits={item.fractionDigits ?? 0}
                {...(item.unit ? { unit: item.unit } : {})}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

interface DataRowProps {
  label: string
  icon?: LucideIcon
  value: number | null
  target?: number | null
  unit?: string
  fractionDigits?: number
  meta?: ReactNode
  showProgress?: boolean
  tone?: ProgressTone
  className?: string
}

/**
 * Compact labelled value, optionally against a target:
 *   PROTEIN                       105 / 140 G
 *   ██████████████░░░░░░
 */
export function DataRow({
  label,
  icon: Icon,
  value,
  target = null,
  unit,
  fractionDigits = 0,
  meta,
  showProgress = true,
  tone,
  className,
}: DataRowProps) {
  const hasTarget = target !== null
  return (
    <div className={cn('flex flex-col gap-2 py-3', className)}>
      <div className="flex items-baseline gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0 self-center text-muted-foreground"
            />
          )}
          <span className="truncate label-section text-foreground-secondary">{label}</span>
        </span>
        {meta && <span className="label-mono text-muted-foreground">{meta}</span>}
        <span className="ml-auto shrink-0 text-sm tabular-nums">
          <span className="font-semibold text-foreground">
            {value === null ? NO_VALUE : formatNumber(value, fractionDigits)}
          </span>
          {hasTarget && (
            <span className="text-muted-foreground"> / {formatNumber(target, fractionDigits)}</span>
          )}
          {unit && <span className="ml-1 label-mono text-muted-foreground">{unit}</span>}
        </span>
      </div>
      {hasTarget && showProgress && (
        <ProgressBar
          value={value}
          max={target}
          label={label}
          {...(tone ? { tone } : {})}
          valueText={
            value === null
              ? undefined
              : `${formatNumber(value, fractionDigits)} of ${formatNumber(target, fractionDigits)}${unit ? ` ${unit}` : ''}`
          }
        />
      )}
    </div>
  )
}
