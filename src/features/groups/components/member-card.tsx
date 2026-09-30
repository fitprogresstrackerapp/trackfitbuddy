import { Check, Dumbbell, Flame, Footprints, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { formatNumber, NO_VALUE } from '@/lib/format'

import type { MemberDay } from '../api/groups-data'
import { memberCardView, ROLE_LABELS, type MetricView } from '../lib/groups-logic'

/**
 * One member's group-visible day (spec §47): calories and protein against
 * their own target, steps, and whether a workout was logged. Plain values:
 * no colours of success or failure, and nothing is compared across members.
 */
export function MemberCard({ day, isMe }: { day: MemberDay; isMe: boolean }) {
  const view = memberCardView(day)
  return (
    <article
      aria-label={day.name ?? 'Member'}
      className="flex h-full flex-col gap-3 rounded-md border border-border bg-surface-1 px-4 py-3.5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate font-medium text-foreground">
          {day.name ?? 'Member'}
          {isMe && <span className="ml-2 label-mono text-muted-foreground">You</span>}
        </h3>
        {day.role !== 'MEMBER' && (
          <span className="shrink-0 label-mono text-muted-foreground">{ROLE_LABELS[day.role]}</span>
        )}
      </header>
      <dl className="flex flex-col divide-y divide-border border-t border-border text-sm">
        <MetricRow icon={Flame} label="Calories" metric={view.calories} unit="kcal" />
        <MetricRow icon={Target} label="Protein" metric={view.protein} unit="g" />
        <MetricRow icon={Footprints} label="Steps" metric={view.steps} unit="steps" />
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="flex items-center gap-2 text-foreground-secondary">
            <Dumbbell aria-hidden="true" className="size-4 text-muted-foreground" />
            Workout
          </dt>
          <dd className="flex items-center gap-1.5 text-foreground">
            {view.workout === 'done' ? (
              <>
                <Check aria-hidden="true" className="size-4 text-primary" />
                Workout done
              </>
            ) : (
              <span className="text-muted-foreground">No workout logged</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  )
}

function MetricRow({
  icon: Icon,
  label,
  metric,
  unit,
}: {
  icon: LucideIcon
  label: string
  metric: MetricView
  unit: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="flex items-center gap-2 text-foreground-secondary">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {label}
      </dt>
      <dd className="text-right tabular-nums">
        {metric.actual === null ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {NO_VALUE}
            </span>
            <span className="sr-only">Not recorded</span>
          </>
        ) : (
          <span className="text-foreground">{formatNumber(metric.actual)}</span>
        )}
        {metric.target !== null ? (
          <span className="text-muted-foreground">
            {' '}
            / {formatNumber(metric.target)} {unit}
          </span>
        ) : (
          metric.actual !== null && <span className="text-muted-foreground"> {unit}</span>
        )}
      </dd>
    </div>
  )
}
