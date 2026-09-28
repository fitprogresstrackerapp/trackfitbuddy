import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { Page, PageHeader } from '@/components/layout/page'
import { SegmentedControl } from '@/components/ui/tabs'
import { useAccount } from '@/features/auth/auth-context'
import { formatShortDate, safeTimeZone, todayInTimeZone } from '@/lib/dates/local-date'

import {
  useBodyPeriod,
  useCurrentPlan,
  useNutritionPeriod,
  useStepsPeriod,
  useTrainingPeriod,
} from '../api/progress-queries'
import { BodyProgress } from '../components/body-progress'
import { CycleSummary } from '../components/cycle-summary'
import { GoalsProgress } from '../components/goals-progress'
import { NutritionProgress } from '../components/nutrition-progress'
import { ActivityProgress, TrainingProgress } from '../components/training-progress'
import {
  change,
  compositionSeries,
  cyclePeriod,
  DEFAULT_RANGE,
  hasBodyData,
  isRangeKey,
  RANGE_KEYS,
  rangePeriod,
  weightSeries,
} from '../lib/progress-logic'
import type { RangeKey } from '../types'

const RANGE_OPTIONS = RANGE_KEYS.map((key) => ({ value: key, label: key }))

/**
 * Progress (spec §44–45): deterministic self-analysis from stored records.
 * The current recommendation cycle is summarised first and independently of
 * the selected range (7D–1Y), which drives every section below. Each section
 * loads and fails on its own; missing data is never shown as zero.
 */
export function ProgressPage() {
  const { profile } = useAccount()
  const today = todayInTimeZone(safeTimeZone(profile.timezone))
  const [params, setParams] = useSearchParams()
  const raw = params.get('range')
  const range: RangeKey = isRangeKey(raw) ? raw : DEFAULT_RANGE
  const period = useMemo(() => rangePeriod(range, today), [range, today])

  const plan = useCurrentPlan(profile.id, today)
  const cycle = plan.data?.cycle ?? null
  const cycleRange = useMemo(() => (cycle ? cyclePeriod(cycle, today) : null), [cycle, today])

  const cycleNutrition = useNutritionPeriod(profile.id, cycleRange)
  const cycleTraining = useTrainingPeriod(profile.id, cycleRange)
  const cycleBody = useBodyPeriod(profile.id, cycleRange)

  const nutrition = useNutritionPeriod(profile.id, period)
  const training = useTrainingPeriod(profile.id, period)
  const body = useBodyPeriod(profile.id, period)
  const steps = useStepsPeriod(profile.id, period)

  const bodyContext = useMemo(() => {
    if (!body.data) return { weight: null, bodyFat: null }
    return {
      weight: change(
        weightSeries(body.data.weights).map((point) => ({
          date: point.date,
          value: point.weightKg,
        })),
      ),
      bodyFat: change(compositionSeries(body.data.composition, 'bodyFatPercent')),
    }
  }, [body.data])

  function selectRange(next: RangeKey) {
    setParams(
      (current) => {
        if (next === DEFAULT_RANGE) current.delete('range')
        else current.set('range', next)
        return current
      },
      { replace: true },
    )
  }

  // Sections keep their priority order, except that a Body section without
  // any measurements moves below the sections that do have data (spec §40).
  const bodySection = <BodyProgress key="body" query={body} />
  const bodyEmpty = body.isSuccess && !hasBodyData(body.data)
  const sections: ReactNode[] = [
    ...(bodyEmpty ? [] : [bodySection]),
    <NutritionProgress key="nutrition" query={nutrition} period={period} today={today} />,
    <TrainingProgress key="training" query={training} period={period} today={today} />,
    <ActivityProgress key="activity" query={training} steps={steps} period={period} />,
    ...(bodyEmpty ? [bodySection] : []),
    <GoalsProgress
      key="goals"
      plan={plan}
      weight={bodyContext.weight}
      bodyFat={bodyContext.bodyFat}
    />,
  ]

  return (
    <Page>
      <PageHeader
        eyebrow={`${formatShortDate(period.start)} – ${formatShortDate(period.end)}`}
        title="Progress"
        actions={
          <SegmentedControl
            label="Time range"
            value={range}
            onValueChange={selectRange}
            options={RANGE_OPTIONS}
          />
        }
      />
      <CycleSummary
        plan={plan}
        period={cycleRange}
        nutrition={cycleNutrition}
        training={cycleTraining}
        body={cycleBody}
        today={today}
      />
      {sections}
    </Page>
  )
}
