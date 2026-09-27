import { cn } from '@/lib/utils'

export type ProgressTone = 'auto' | 'default' | 'complete' | 'attention'

function percentOf(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

interface ProgressBarProps {
  /** Current value; `null` = no data (rendered as an empty, hatched track — never as 0). */
  value: number | null
  max: number
  /** Accessible name, e.g. "Protein". */
  label: string
  /** Accessible value text, e.g. "105 of 140 grams". Defaults to a percentage. */
  valueText?: string
  /**
   * auto      → complete when value ≥ max, otherwise default
   * attention → e.g. calories above the acceptable range (caller decides)
   */
  tone?: ProgressTone
  size?: 'sm' | 'md'
  className?: string
}

/** Compact value-against-target bar. Colour is never the only signal: pair with text. */
export function ProgressBar({
  value,
  max,
  label,
  valueText,
  tone = 'auto',
  size = 'sm',
  className,
}: ProgressBarProps) {
  const missing = value === null
  const percent = missing ? 0 : percentOf(value, max)
  const resolved = tone === 'auto' ? (!missing && value >= max ? 'complete' : 'default') : tone

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={missing ? undefined : Math.min(value, max)}
      aria-valuetext={missing ? 'No data' : (valueText ?? `${String(Math.round(percent))}%`)}
      data-state={missing ? 'missing' : resolved}
      className={cn(
        'relative w-full overflow-hidden rounded-xs bg-surface-2',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        missing &&
          'bg-[repeating-linear-gradient(135deg,var(--color-surface-2)_0_4px,var(--color-border)_4px_5px)]',
        className,
      )}
    >
      {!missing && (
        <div
          className={cn(
            'h-full rounded-xs transition-[width] duration-500 ease-(--ease-standard)',
            resolved === 'default' && 'bg-primary/75',
            resolved === 'complete' && 'bg-primary',
            resolved === 'attention' && 'bg-warning',
          )}
          style={{ width: `${String(percent)}%` }}
        />
      )}
    </div>
  )
}
