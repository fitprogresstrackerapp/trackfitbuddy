import type { UseQueryResult } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Metric } from '@/components/data/metric'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { activityLabel } from '@/features/activity/lib/activity-types'
import { workoutLabel } from '@/features/workout/lib/workout-types'
import { formatNumber } from '@/lib/format'

import { isTransitionWeek } from '../lib/home-logic'
import type { HomePlan, HomeTraining, TrainingEntry } from '../types'
import { SectionError } from './section-error'

function TodayCell({
  icon: Icon,
  label,
  meta,
  children,
}: {
  icon: LucideIcon
  label: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-l border-border p-4 sm:min-h-36">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="label-section text-foreground-secondary">{label}</h3>
        {meta && <span className="ml-auto label-mono text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function minutes(entries: readonly TrainingEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.durationMinutes, 0)
}

function StepsCell({ steps }: { steps: number | null }) {
  // No step goal exists in Phase 1 (spec §19), so none is shown or invented.
  return (
    <TodayCell icon={ICONS.steps} label="Steps">
      <Metric value={steps} size="md" unit="STEPS" />
      {steps === null && <Muted>No entry today</Muted>}
    </TodayCell>
  )
}

function WorkoutCell({
  training,
  plan,
}: {
  training: HomeTraining
  plan: UseQueryResult<HomePlan>
}) {
  const capacity = plan.data?.targets?.workoutsPerWeek ?? null
  const transition = isTransitionWeek(plan.data?.cycle ?? null, training.week)
  const done = training.workoutsToday

  return (
    <TodayCell icon={ICONS.workout} label="Workout">
      {done.length > 0 ? (
        <div className="flex flex-col items-start gap-2">
          <StatusBadge status="completed" />
          <ul className="space-y-0.5 text-sm text-foreground">
            {done.map((workout) => (
              <li key={workout.id}>
                {workoutLabel(workout.type, workout.customName)} · {workout.durationMinutes} min
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Muted>No workout logged today</Muted>
      )}
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {training.workoutDaysThisWeek > 0 ? (
          <>
            <Metric value={training.workoutDaysThisWeek} size="sm" />
            <span className="label-mono text-muted-foreground">
              {capacity === null ? '' : `/ ${String(capacity)} `}
              days this week
            </span>
          </>
        ) : (
          <span className="label-mono text-muted-foreground">
            No workouts this week{capacity === null ? '' : ` · capacity ${String(capacity)} / week`}
          </span>
        )}
        {transition && <span className="label-mono text-warning">· Partial week</span>}
      </div>
    </TodayCell>
  )
}

function ActivityCell({ activities }: { activities: readonly TrainingEntry[] }) {
  if (activities.length === 0) {
    return (
      <TodayCell icon={ICONS.activity} label="Activity">
        <Muted>No activity logged today</Muted>
      </TodayCell>
    )
  }

  const [first] = activities
  const summary =
    activities.length === 1 && first
      ? `${activityLabel(first.type, first.customName)} · ${String(first.durationMinutes)} min`
      : `${String(activities.length)} activities · ${String(minutes(activities))} min`
  const known = activities.filter((activity) => activity.calories !== null)
  const estimated = known.reduce((sum, activity) => sum + (activity.calories ?? 0), 0)

  return (
    <TodayCell icon={ICONS.activity} label="Activity">
      <p className="text-sm text-foreground">{summary}</p>
      {known.length > 0 && (
        <p className="mt-auto label-mono text-muted-foreground">
          ≈ {formatNumber(estimated)} kcal estimated
        </p>
      )}
    </TodayCell>
  )
}

function TodaySkeleton() {
  return (
    <div className="-mt-px -ml-px grid sm:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 border-t border-l border-border p-4 sm:min-h-36"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  )
}

interface TodaySectionProps {
  training: UseQueryResult<HomeTraining>
  plan: UseQueryResult<HomePlan>
}

/** Steps, workout and activity for today. Activities stay separate from workouts (spec §18). */
export function TodaySection({ training, plan }: TodaySectionProps) {
  return (
    <Section title="Today">
      {training.isError ? (
        <SectionError
          title="Couldn’t load today’s activity"
          onRetry={() => void training.refetch()}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {training.isPending ? (
            <>
              <span className="sr-only" role="status">
                Loading today’s activity
              </span>
              <TodaySkeleton />
            </>
          ) : (
            <div className="-mt-px -ml-px grid sm:grid-cols-3">
              <StepsCell steps={training.data.steps} />
              <WorkoutCell training={training.data} plan={plan} />
              <ActivityCell activities={training.data.activitiesToday} />
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
