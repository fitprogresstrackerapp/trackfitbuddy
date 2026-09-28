import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'

import { TrendChart } from '@/components/charts/trend-chart'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { ICONS } from '@/constants/icons'
import { formatShortDate } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import { formatSigned } from '../lib/progress-format'
import { change, compositionSeries, weightSeries, type Change } from '../lib/progress-logic'
import type { BodyPeriodData } from '../types'
import { Figure, FigureGrid, NoData, SectionSkeleton, SubHeading } from './progress-ui'

function changeValue(value: Change, unit: string, digits: number): string {
  return value.delta === null
    ? `${formatNumber(value.last.value, digits)} ${unit}`
    : `${formatNumber(value.first.value, digits)} → ${formatNumber(value.last.value, digits)} ${unit}`
}

function changeDetail(value: Change, deltaUnit: string, digits: number): string {
  if (value.delta === null) return `One measurement · ${formatShortDate(value.last.date)}`
  return `${formatSigned(value.delta, digits, deltaUnit)} · ${formatShortDate(value.first.date)} – ${formatShortDate(value.last.date)}`
}

/**
 * Body (spec §20–21): real measurements only — never interpolated, never
 * inferred. InBody wins over a manual entry on the same date; both stay in
 * the history. Body-fat change is in percentage points.
 */
export function BodyProgress({ query }: { query: UseQueryResult<BodyPeriodData> }) {
  const derived = useMemo(() => {
    if (!query.data) return null
    const weights = weightSeries(query.data.weights)
    const bodyFat = compositionSeries(query.data.composition, 'bodyFatPercent')
    const muscle = compositionSeries(query.data.composition, 'muscleMassKg')
    return {
      weights,
      weight: change(weights.map((point) => ({ date: point.date, value: point.weightKg }))),
      bodyFat,
      bodyFatChange: change(bodyFat),
      muscle,
      muscleChange: change(muscle),
    }
  }, [query.data])

  return (
    <Section title="Body">
      {query.isError ? (
        <SectionError title="Body data unavailable" onRetry={() => void query.refetch()} />
      ) : !derived ? (
        <SectionSkeleton />
      ) : !derived.weight && !derived.bodyFatChange && !derived.muscleChange ? (
        <NoData title="No weight data">
          Add a weight measurement to see your trend. InBody results appear here too.
        </NoData>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <FigureGrid className="content-start lg:grid-cols-1">
            <Figure
              label="Weight"
              icon={ICONS.weight}
              value={derived.weight ? changeValue(derived.weight, 'kg', 1) : '—'}
              detail={
                derived.weight ? changeDetail(derived.weight, 'kg', 1) : 'No weight in this period'
              }
            />
            {derived.bodyFatChange && (
              <Figure
                label="Body fat"
                value={changeValue(derived.bodyFatChange, '%', 1)}
                detail={changeDetail(derived.bodyFatChange, 'pp', 1)}
              />
            )}
            {derived.muscleChange && (
              <Figure
                label="Muscle mass"
                value={changeValue(derived.muscleChange, 'kg', 1)}
                detail={changeDetail(derived.muscleChange, 'kg', 1)}
              />
            )}
            {!derived.bodyFatChange && !derived.muscleChange && (
              <Figure label="Body composition" value="—" detail="No InBody data in this period" />
            )}
          </FigureGrid>

          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-3">
              <SubHeading meta={`${String(derived.weights.length)} measured days`}>
                Weight trend
              </SubHeading>
              {derived.weights.length >= 2 ? (
                <TrendChart
                  label="Weight measurements over time"
                  summary={
                    derived.weight
                      ? `Weight ${changeValue(derived.weight, 'kg', 1)}, ${changeDetail(derived.weight, 'kg', 1)}.`
                      : ''
                  }
                  unit="kg"
                  fractionDigits={1}
                  valueLabel="Weight"
                  data={derived.weights.map((point) => ({
                    date: point.date,
                    value: point.weightKg,
                    note: point.source === 'INBODY' ? 'InBody' : 'Manual',
                  }))}
                />
              ) : (
                <NoData title="Not enough data">
                  More measurements are needed to show a trend.
                </NoData>
              )}
            </div>
            {derived.bodyFat.length >= 2 && (
              <div className="flex flex-col gap-3">
                <SubHeading meta="InBody">Body fat trend</SubHeading>
                <TrendChart
                  height={160}
                  label="Body fat percentage over time"
                  summary={
                    derived.bodyFatChange
                      ? `Body fat ${changeValue(derived.bodyFatChange, '%', 1)}, ${changeDetail(derived.bodyFatChange, 'pp', 1)}.`
                      : ''
                  }
                  unit="%"
                  fractionDigits={1}
                  valueLabel="Body fat"
                  data={derived.bodyFat.map((point) => ({ ...point, note: 'InBody' }))}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
