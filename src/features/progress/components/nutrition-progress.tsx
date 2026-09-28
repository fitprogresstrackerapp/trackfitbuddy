import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { TrendChart } from '@/components/charts/trend-chart'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { SegmentedControl } from '@/components/ui/tabs'
import { ICONS } from '@/constants/icons'
import { formatNumber, NO_VALUE } from '@/lib/format'

import { formatPercent } from '../lib/progress-format'
import {
  datesIn,
  nutritionSeries,
  summarizeNutrition,
  targetsByDate,
  type NutrientKey,
  type NutrientSummary,
} from '../lib/progress-logic'
import type { NutritionPeriodData, Period } from '../types'
import { Figure, FigureGrid, NoData, SectionSkeleton, SubHeading } from './progress-ui'

type MacroKey = Exclude<NutrientKey, 'calories'>

const MACROS: readonly { value: MacroKey; label: string }[] = [
  { value: 'proteinG', label: 'Protein' },
  { value: 'carbsG', label: 'Carbs' },
  { value: 'fatG', label: 'Fat' },
  { value: 'fiberG', label: 'Fiber' },
]

function adherenceText(summary: NutrientSummary, verb: string): string {
  const { met, eligible, rate } = summary.adherence
  if (eligible === 0) return 'No eligible tracked days'
  return `${verb} on ${String(met)} of ${String(eligible)} eligible days (${formatPercent(rate)})`
}

function amount(value: number | null, unit: string, digits = 0): string {
  return value === null ? NO_VALUE : `${formatNumber(value, digits)} ${unit}`
}

interface NutritionProgressProps {
  query: UseQueryResult<NutritionPeriodData>
  period: Period
  today: string
}

/**
 * Calories against the date-specific target, then one macro at a time.
 * Adherence counts eligible tracked days only (spec §28).
 */
export function NutritionProgress({ query, period, today }: NutritionProgressProps) {
  const [macro, setMacro] = useState<MacroKey>('proteinG')

  const derived = useMemo(() => {
    if (!query.data) return null
    const targets = targetsByDate(datesIn(period), query.data.snapshots, query.data.cycles)
    const points = nutritionSeries(period, query.data.days, targets)
    return { points, summary: summarizeNutrition(points, targets, today) }
  }, [query.data, period, today])

  return (
    <Section
      title="Nutrition"
      meta={
        derived
          ? `${String(derived.summary.trackedDays)} tracked ${derived.summary.trackedDays === 1 ? 'day' : 'days'}`
          : undefined
      }
    >
      {query.isError ? (
        <SectionError title="Nutrition data unavailable" onRetry={() => void query.refetch()} />
      ) : !derived ? (
        <SectionSkeleton />
      ) : query.data?.days.length === 0 ? (
        <NoData title="No food logged">
          Log meals to see your intake against your targets for this period.
        </NoData>
      ) : (
        <NutritionContent derived={derived} macro={macro} onMacro={setMacro} />
      )}
    </Section>
  )
}

function NutritionContent({
  derived,
  macro,
  onMacro,
}: {
  derived: {
    points: ReturnType<typeof nutritionSeries>
    summary: ReturnType<typeof summarizeNutrition>
  }
  macro: MacroKey
  onMacro: (value: MacroKey) => void
}) {
  const { points, summary } = derived
  const calories = summary.nutrients.calories
  const macroLabel = MACROS.find((entry) => entry.value === macro)?.label ?? 'Protein'
  const loggedDays = points.filter((point) => point.actual.calories !== null).length

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <FigureGrid className="content-start lg:grid-cols-1">
          <Figure
            label="Average intake"
            icon={ICONS.calories}
            value={amount(calories.averageActual, 'kcal')}
            detail={
              calories.averageTarget === null
                ? 'No target for these days'
                : `Target ${amount(calories.averageTarget, 'kcal')} on average`
            }
          />
          <Figure
            label="Calories in range"
            value={formatPercent(calories.adherence.rate)}
            detail={adherenceText(calories, 'Within range')}
          />
        </FigureGrid>
        <div className="flex min-w-0 flex-col gap-3">
          <SubHeading meta={`${String(loggedDays)} logged days`}>Calories vs target</SubHeading>
          <TrendChart
            variant="bar"
            label="Daily calories against the target in force each day"
            summary={`Calories logged on ${String(loggedDays)} days. ${adherenceText(calories, 'Within the calorie range')}.`}
            unit="kcal"
            valueLabel="Logged"
            data={points.map((point) => ({
              date: point.date,
              value: point.actual.calories,
              target: point.target.calories,
            }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SubHeading>Macros</SubHeading>
          <SegmentedControl label="Macro" value={macro} onValueChange={onMacro} options={MACROS} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TrendChart
            variant="bar"
            height={180}
            label={`Daily ${macroLabel.toLowerCase()} against the target in force each day`}
            summary={adherenceText(summary.nutrients[macro], `${macroLabel} target met`)}
            unit="g"
            fractionDigits={1}
            valueLabel={macroLabel}
            data={points.map((point) => ({
              date: point.date,
              value: point.actual[macro],
              target: point.target[macro],
            }))}
          />
          <table className="w-full text-sm">
            <caption className="sr-only">Average macros and adherence on tracked days</caption>
            <thead>
              <tr className="label-mono text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-normal">
                  Macro
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Avg / target
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Met
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {MACROS.map((entry) => {
                const nutrient = summary.nutrients[entry.value]
                return (
                  <tr key={entry.value} aria-current={entry.value === macro || undefined}>
                    <th
                      scope="row"
                      className={`py-2.5 text-left font-medium ${entry.value === macro ? 'text-foreground' : 'text-foreground-secondary'}`}
                    >
                      {entry.label}
                    </th>
                    <td className="py-2.5 text-right text-foreground tabular-nums">
                      {amount(nutrient.averageActual, 'g')}
                      <span className="text-muted-foreground">
                        {' '}
                        /{' '}
                        {nutrient.averageTarget === null
                          ? NO_VALUE
                          : formatNumber(nutrient.averageTarget)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-foreground-secondary tabular-nums">
                      {formatPercent(nutrient.adherence.rate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Averages and adherence use completed days with logged food and a target; today counts once
          it ends. Days without food are not counted as misses.
        </p>
      </div>
    </div>
  )
}
