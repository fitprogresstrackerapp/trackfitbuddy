import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'

import { TrendChart } from '@/components/charts/trend-chart'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { ICONS } from '@/constants/icons'
import { formatDuration } from '@/features/training/lib/training'
import { formatNumber, NO_VALUE } from '@/lib/format'

import { formatPercent, formatWeekLabel } from '../lib/progress-format'
import {
  datesIn,
  entryTotals,
  stepsSummary,
  targetsByDate,
  weeklyMinutes,
  weeklyTraining,
  workoutAdherence,
  type WeekSummary,
} from '../lib/progress-logic'
import type { Period, StepsDay, TrainingPeriodData } from '../types'
import { Figure, FigureGrid, NoData, SectionSkeleton, SubHeading } from './progress-ui'

const STATUS_TEXT: Record<WeekSummary['status'], string> = {
  counted: '',
  partial: 'Partial week',
  'in-progress': 'In progress',
  'no-capacity': 'No capacity set',
}

function weekLabel(start: string) {
  const [y = 1970, m = 1, d = 1] = start.split('-').map(Number)
  const end = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10)
  return formatWeekLabel(start, end)
}

interface TrainingProgressProps {
  query: UseQueryResult<TrainingPeriodData>
  period: Period
  today: string
}

/**
 * Workouts (spec §16–17): workout days against weekly capacity, with the same
 * shared Monday–Sunday counting as Home and Workout. Workout type never
 * matters; partial and in-progress weeks are shown but not judged.
 */
export function TrainingProgress({ query, period, today }: TrainingProgressProps) {
  const derived = useMemo(() => {
    if (!query.data) return null
    const targets = targetsByDate(
      datesIn(query.data.fetched),
      query.data.snapshots,
      query.data.cycles,
    )
    const weeks = weeklyTraining(period, query.data.workouts, targets, query.data.cycles, today)
    return {
      weeks,
      adherence: workoutAdherence(weeks),
      totals: entryTotals(query.data.workouts, period),
    }
  }, [query.data, period, today])

  return (
    <Section title="Training">
      {query.isError ? (
        <SectionError title="Training data unavailable" onRetry={() => void query.refetch()} />
      ) : !derived ? (
        <SectionSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          <FigureGrid>
            <Figure
              label="Weekly completion"
              icon={ICONS.workout}
              value={
                derived.adherence.expected === 0
                  ? NO_VALUE
                  : `${String(derived.adherence.done)} / ${String(derived.adherence.expected)}`
              }
              detail={
                derived.adherence.expected === 0
                  ? 'No completed week with a workout capacity yet'
                  : `Workout days in ${String(derived.adherence.weeks)} full ${derived.adherence.weeks === 1 ? 'week' : 'weeks'} · ${formatPercent(derived.adherence.rate)}`
              }
            />
            <Figure
              label="Workout days"
              value={derived.totals ? formatNumber(derived.totals.days) : NO_VALUE}
              detail={
                derived.totals
                  ? `${String(derived.totals.sessions)} sessions`
                  : 'No workouts logged'
              }
            />
            <Figure
              label="Workout time"
              value={derived.totals ? formatDuration(derived.totals.minutes) : NO_VALUE}
              detail={
                derived.totals
                  ? `Avg ${formatDuration(derived.totals.averageMinutes)} per session`
                  : undefined
              }
            />
            <Figure
              label="Workout calories"
              value={derived.totals ? `${formatNumber(derived.totals.calories)} kcal` : NO_VALUE}
              detail="Stored per workout · approximate"
            />
          </FigureGrid>

          {derived.weeks.some((week) => week.done > 0 || week.capacity !== null) ? (
            <WeeklyCompletion weeks={derived.weeks} />
          ) : (
            <NoData title="No workouts yet">
              Logged workouts appear here week by week against your workout capacity.
            </NoData>
          )}
        </div>
      )}
    </Section>
  )
}

function WeeklyCompletion({ weeks }: { weeks: readonly WeekSummary[] }) {
  return (
    <div className="flex flex-col gap-3">
      <SubHeading meta="Monday–Sunday">Weekly completion</SubHeading>
      {weeks.length > 6 && (
        <TrendChart
          variant="bar"
          height={180}
          label="Workout days per week against weekly capacity"
          summary={`${String(weeks.length)} weeks shown. Any workout type counts toward capacity.`}
          unit="days"
          valueLabel="Workout days"
          targetLabel="Capacity"
          dateLabel={(start) => `Week of ${weekLabel(start)}`}
          data={weeks.map((week) => ({
            date: week.start,
            value: week.done,
            target: week.capacity,
            note: STATUS_TEXT[week.status] || null,
          }))}
        />
      )}
      {weeks.length <= 6 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Workout days per Monday–Sunday week</caption>
            <thead>
              <tr className="label-mono text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-normal">
                  Week
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Completed
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Capacity
                </th>
                <th scope="col" className="pb-2 pl-4 text-left font-normal">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {[...weeks].reverse().map((week) => (
                <tr key={week.start}>
                  <th
                    scope="row"
                    className="py-2.5 text-left font-medium whitespace-nowrap text-foreground-secondary"
                  >
                    {weekLabel(week.start)}
                  </th>
                  <td className="py-2.5 text-right text-foreground tabular-nums">{week.done}</td>
                  <td className="py-2.5 text-right text-foreground-secondary tabular-nums">
                    {week.capacity ?? NO_VALUE}
                  </td>
                  <td className="py-2.5 pl-4 label-mono text-muted-foreground">
                    {STATUS_TEXT[week.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface ActivityProgressProps {
  query: UseQueryResult<TrainingPeriodData>
  steps: UseQueryResult<StepsDay[]>
  period: Period
}

/**
 * Activities and steps (spec §18–19): tracked for trends only. No frequency
 * or step goal exists in Phase 1, so nothing is ever met or missed.
 */
export function ActivityProgress({ query, steps, period }: ActivityProgressProps) {
  const derived = useMemo(() => {
    if (!query.data) return null
    return {
      totals: entryTotals(query.data.activities, period),
      weekly: weeklyMinutes(query.data.activities, period),
    }
  }, [query.data, period])
  const stepStats = steps.data ? stepsSummary(steps.data) : null

  return (
    <Section title="Activity">
      {query.isError ? (
        <SectionError title="Activity data unavailable" onRetry={() => void query.refetch()} />
      ) : !derived ? (
        <SectionSkeleton chart={false} />
      ) : (
        <div className="flex flex-col gap-6">
          {derived.totals ? (
            <FigureGrid>
              <Figure
                label="Sessions"
                icon={ICONS.activity}
                value={formatNumber(derived.totals.sessions)}
                detail={`On ${String(derived.totals.days)} ${derived.totals.days === 1 ? 'day' : 'days'}`}
              />
              <Figure label="Time" value={formatDuration(derived.totals.minutes)} />
              <Figure
                label="Calories"
                value={`${formatNumber(derived.totals.calories)} kcal`}
                detail="Estimated · not added to food targets"
              />
            </FigureGrid>
          ) : (
            <NoData title="No activities">
              Walking, cricket, cycling and other activities appear here. There is no activity
              target.
            </NoData>
          )}

          {derived.weekly.filter((week) => week.minutes !== null).length >= 2 && (
            <div className="flex flex-col gap-3">
              <SubHeading meta="Monday–Sunday">Activity time per week</SubHeading>
              <TrendChart
                variant="bar"
                height={160}
                label="Activity minutes per week"
                summary={`Activity time in ${String(derived.weekly.filter((week) => week.minutes !== null).length)} weeks.`}
                unit="min"
                valueLabel="Activity time"
                dateLabel={(start) => `Week of ${weekLabel(start)}`}
                data={derived.weekly.map((week) => ({ date: week.start, value: week.minutes }))}
              />
            </div>
          )}

          <div className="flex flex-col gap-3">
            <SubHeading>Steps</SubHeading>
            {steps.isError ? (
              <SectionError title="Steps unavailable" onRetry={() => void steps.refetch()} />
            ) : !steps.data ? null : stepStats ? (
              <>
                <p className="text-sm text-foreground-secondary">
                  <span className="metric text-xl text-foreground">
                    {formatNumber(stepStats.average)}
                  </span>{' '}
                  average on {stepStats.days} {stepStats.days === 1 ? 'day' : 'days'} with an entry
                </p>
                {stepStats.days >= 2 && (
                  <TrendChart
                    variant="bar"
                    height={140}
                    label="Daily steps"
                    summary={`Average ${formatNumber(stepStats.average)} steps on ${String(stepStats.days)} days with an entry.`}
                    unit="steps"
                    valueLabel="Steps"
                    data={steps.data.map((day) => ({ date: day.date, value: day.steps }))}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No step entries in this period.</p>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
