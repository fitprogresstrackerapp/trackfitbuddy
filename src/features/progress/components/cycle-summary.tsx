import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { ICONS } from '@/constants/icons'
import { formatDuration } from '@/features/training/lib/training'
import { formatMonthName, formatShortDate } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import type { CurrentPlan } from '../api/progress-data'
import { formatPercent, formatSigned } from '../lib/progress-format'
import {
  change,
  compositionSeries,
  datesIn,
  entryTotals,
  nutritionSeries,
  summarizeNutrition,
  targetsByDate,
  weeklyTraining,
  weightSeries,
  workoutAdherence,
} from '../lib/progress-logic'
import type { BodyPeriodData, NutritionPeriodData, Period, TrainingPeriodData } from '../types'
import { Figure, FigureGrid, SectionSkeleton } from './progress-ui'

interface CycleSummaryProps {
  plan: UseQueryResult<CurrentPlan>
  period: Period | null
  nutrition: UseQueryResult<NutritionPeriodData>
  training: UseQueryResult<TrainingPeriodData>
  body: UseQueryResult<BodyPeriodData>
  today: string
}

/**
 * The current recommendation cycle (spec §29): recommendation-to-recommendation,
 * not a calendar month. Independent of the selected range. Only metrics with
 * underlying data are shown.
 */
export function CycleSummary({
  plan,
  period,
  nutrition,
  training,
  body,
  today,
}: CycleSummaryProps) {
  const cycle = plan.data?.cycle ?? null

  const metrics = useMemo(() => {
    if (!cycle || !period) return null
    const result: {
      workouts?: {
        done: number
        expected: number
        rate: number | null
        current: { done: number; capacity: number | null } | null
      }
      nutrition?: ReturnType<typeof summarizeNutrition>
      weight?: ReturnType<typeof change>
      bodyFat?: ReturnType<typeof change>
      activities?: ReturnType<typeof entryTotals>
    } = {}
    if (training.data) {
      const targets = targetsByDate(
        datesIn(training.data.fetched),
        training.data.snapshots,
        training.data.cycles,
      )
      const weeks = weeklyTraining(
        period,
        training.data.workouts,
        targets,
        training.data.cycles,
        today,
      )
      const adherence = workoutAdherence(weeks)
      const current = weeks.find((week) => week.status === 'in-progress')
      result.workouts = {
        ...adherence,
        current: current ? { done: current.done, capacity: current.capacity } : null,
      }
      result.activities = entryTotals(training.data.activities, period)
    }
    if (nutrition.data) {
      const targets = targetsByDate(
        datesIn(period),
        nutrition.data.snapshots,
        nutrition.data.cycles,
      )
      result.nutrition = summarizeNutrition(
        nutritionSeries(period, nutrition.data.days, targets),
        targets,
        today,
      )
    }
    if (body.data) {
      result.weight = change(
        weightSeries(body.data.weights).map((point) => ({
          date: point.date,
          value: point.weightKg,
        })),
      )
      result.bodyFat = change(compositionSeries(body.data.composition, 'bodyFatPercent'))
    }
    return result
  }, [cycle, period, training.data, nutrition.data, body.data, today])

  return (
    <Section
      title="Current cycle"
      meta={cycle ? cycleStatusMeta(cycle.status, cycle.reviewDeadline) : undefined}
    >
      {plan.isError ? (
        <SectionError title="Current cycle unavailable" onRetry={() => void plan.refetch()} />
      ) : plan.isPending ? (
        <SectionSkeleton chart={false} />
      ) : !cycle || !period ? (
        <EmptyState
          icon={ICONS.goals}
          title="No recommendation"
          description="Cycle progress appears once your first recommendation exists. Historical records below are still shown."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="heading-block text-foreground">
              {formatMonthName(cycle.periodStart)} progress
            </p>
            <p className="label-mono text-muted-foreground">
              Recommendation cycle · {formatShortDate(cycle.periodStart)} –{' '}
              {cycle.periodEnd ? formatShortDate(cycle.periodEnd) : 'ongoing'}
            </p>
          </div>
          {(nutrition.isError || training.isError || body.isError) && (
            <InlineAlert tone="warning" title="Some cycle data couldn’t be loaded">
              Metrics that loaded are shown; the others are left out rather than shown as zero.
            </InlineAlert>
          )}
          {!metrics || nutrition.isPending || training.isPending || body.isPending ? (
            <SectionSkeleton chart={false} />
          ) : (
            <CycleFigures metrics={metrics} />
          )}
        </div>
      )}
    </Section>
  )
}

function cycleStatusMeta(status: 'IN_REVIEW' | 'LOCKED', reviewDeadline: string) {
  return status === 'IN_REVIEW' ? (
    <StatusBadge status="pending" label={`In review until ${formatShortDate(reviewDeadline)}`} />
  ) : (
    <StatusBadge status="active" />
  )
}

function CycleFigures({
  metrics,
}: {
  metrics: {
    workouts?: {
      done: number
      expected: number
      rate: number | null
      current: { done: number; capacity: number | null } | null
    }
    nutrition?: ReturnType<typeof summarizeNutrition>
    weight?: ReturnType<typeof change>
    bodyFat?: ReturnType<typeof change>
    activities?: ReturnType<typeof entryTotals>
  }
}) {
  const figures = []
  const { workouts, nutrition, weight, bodyFat, activities } = metrics

  if (workouts && (workouts.expected > 0 || workouts.current)) {
    figures.push(
      <Figure
        key="workouts"
        label="Workout days"
        icon={ICONS.workout}
        value={
          workouts.expected > 0 ? `${String(workouts.done)} / ${String(workouts.expected)}` : '—'
        }
        detail={[
          workouts.expected > 0
            ? `Full weeks · ${formatPercent(workouts.rate)}`
            : 'No full week yet',
          workouts.current && workouts.current.capacity !== null
            ? `This week ${String(workouts.current.done)} / ${String(workouts.current.capacity)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />,
    )
  }
  if (nutrition && nutrition.nutrients.calories.adherence.eligible > 0) {
    figures.push(
      <Figure
        key="calories"
        label="Calories in range"
        icon={ICONS.calories}
        value={formatPercent(nutrition.nutrients.calories.adherence.rate)}
        detail={`${String(nutrition.nutrients.calories.adherence.met)} of ${String(nutrition.nutrients.calories.adherence.eligible)} eligible tracked days`}
      />,
      <Figure
        key="protein"
        label="Protein met"
        icon={ICONS.protein}
        value={formatPercent(nutrition.nutrients.proteinG.adherence.rate)}
        detail={`${String(nutrition.nutrients.proteinG.adherence.met)} of ${String(nutrition.nutrients.proteinG.adherence.eligible)} eligible tracked days`}
      />,
    )
  }
  if (weight) {
    figures.push(
      <Figure
        key="weight"
        label="Weight"
        icon={ICONS.weight}
        value={
          weight.delta === null
            ? `${formatNumber(weight.last.value, 1)} kg`
            : `${formatNumber(weight.first.value, 1)} → ${formatNumber(weight.last.value, 1)} kg`
        }
        detail={
          weight.delta === null ? 'One measurement this cycle' : formatSigned(weight.delta, 1, 'kg')
        }
      />,
    )
  }
  if (bodyFat) {
    figures.push(
      <Figure
        key="bodyfat"
        label="Body fat"
        value={
          bodyFat.delta === null
            ? `${formatNumber(bodyFat.last.value, 1)}%`
            : `${formatNumber(bodyFat.first.value, 1)} → ${formatNumber(bodyFat.last.value, 1)}%`
        }
        detail={
          bodyFat.delta === null
            ? 'One InBody result this cycle'
            : formatSigned(bodyFat.delta, 1, 'pp')
        }
      />,
    )
  }
  if (activities) {
    figures.push(
      <Figure
        key="activities"
        label="Activities"
        icon={ICONS.activity}
        value={`${String(activities.sessions)} ${activities.sessions === 1 ? 'session' : 'sessions'}`}
        detail={`${formatDuration(activities.minutes)} · ${formatNumber(activities.calories)} kcal`}
      />,
    )
  }

  if (figures.length === 0) {
    return <p className="text-sm text-muted-foreground">No records in this cycle yet.</p>
  }
  return <FigureGrid>{figures}</FigureGrid>
}
