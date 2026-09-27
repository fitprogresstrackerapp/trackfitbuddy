import { MetricBlock, StatRow } from '@/components/data/metric'
import { StatusBadge } from '@/components/data/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { formatDayLabel } from '@/lib/dates/local-date'

import { capacityStatus, formatDuration, trainingTotals } from '../lib/training'
import type { TrainingWeek } from '../types'

interface CapacityBlockProps {
  /** Distinct workout days this week (any workout type counts). */
  done: number
  capacity: number | null
  transition: boolean
  /** Start date of a recommendation that began mid-week. */
  cycleStart: string | null
  isCurrentWeek: boolean
}

/**
 * Weekly workout capacity (spec §16–17): workout days against the capacity of
 * the recommendation. A transition week is shown as partial, never failed.
 */
export function CapacityBlock({
  done,
  capacity,
  transition,
  cycleStart,
  isCurrentWeek,
}: CapacityBlockProps) {
  const status = capacityStatus(done, capacity, transition)
  // No workout logged is shown as "—", not as a zero count (spec §68).
  const value = done > 0 ? done : null

  return (
    <div className="flex flex-col gap-3">
      <MetricBlock
        label="Workouts this week"
        icon={ICONS.workout}
        value={value}
        target={capacity}
        unit="WORKOUTS"
        size="xl"
        {...(capacity === null ? {} : { meta: `Capacity ${String(capacity)} / week` })}
        {...(status.kind === 'met' ? { tone: 'complete' as const } : { tone: 'default' as const })}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground-secondary">
        {status.kind === 'no-capacity' && (
          <p>
            {done === 0 ? 'No workouts logged this week. ' : ''}
            No workout capacity is set yet.
          </p>
        )}
        {status.kind === 'met' && (
          <>
            <StatusBadge status="completed" label="Capacity met" />
            <p>Additional activity is optional.</p>
          </>
        )}
        {status.kind === 'remaining' && (
          <p>
            {done === 0 ? 'No workouts logged this week · ' : ''}
            {isCurrentWeek
              ? `${String(status.remaining)} ${status.remaining === 1 ? 'session' : 'sessions'} remaining`
              : `${String(done)} of ${String(status.capacity)} completed`}
          </p>
        )}
        {status.kind === 'partial' && (
          <>
            <StatusBadge status="pending" label="Partial week" />
            <p>
              {cycleStart
                ? `Your recommendation started ${formatDayLabel(cycleStart)}; this week isn’t judged as a full week.`
                : 'This week isn’t judged as a full week.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Secondary expenditure figures for the week. Tracked separately for
 * analytics; never added to the food target.
 */
export function ExpenditureRow({ week }: { week: TrainingWeek }) {
  const workouts = trainingTotals(week.workouts)
  const activities = trainingTotals(week.activities)
  return (
    <div className="flex flex-col gap-2">
      <StatRow
        items={[
          {
            label: 'Workout calories',
            icon: ICONS.workout,
            value: workouts?.calories ?? null,
            unit: 'KCAL',
          },
          {
            label: 'Activities',
            icon: ICONS.activity,
            value: activities?.sessions ?? null,
            unit: activities?.sessions === 1 ? 'SESSION' : 'SESSIONS',
          },
          {
            label: 'Activity calories',
            icon: ICONS.calories,
            value: activities?.calories ?? null,
            unit: 'KCAL',
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {activities ? `Activity time ${formatDuration(activities.minutes)}. ` : ''}
        Calories are approximate and are not added to your food target.
      </p>
    </div>
  )
}

export function WeekSummarySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-16 w-48" />
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-4 w-56" />
    </div>
  )
}
