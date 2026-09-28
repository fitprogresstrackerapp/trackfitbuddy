import type { ReactNode } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'

import { formatDayLabel, formatShortDate } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import { CHART_AXIS_PROPS, CHART_COLORS, CHART_GRID_PROPS } from './chart-theme'

/*
 * Restrained Recharts wrappers on the design tokens. Missing values stay
 * `null` and render as gaps — never as zero. No animation (quiet, and
 * respects reduced motion). Each chart is a labelled figure with a text
 * summary for assistive technology.
 */

export interface TrendPoint {
  date: string
  value: number | null
  target?: number | null
  /** Optional per-point note shown in the tooltip, e.g. "InBody". */
  note?: string | null
}

interface ChartFrameProps {
  label: string
  summary: string
  height: number
  children: ReactNode
}

function ChartFrame({ label, summary, height, children }: ChartFrameProps) {
  return (
    <figure aria-label={label} className="m-0 w-full min-w-0" style={{ height }}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden="true" className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-surface-1 px-3 py-2 text-xs shadow-lg shadow-black/40">
      {children}
    </div>
  )
}

function makeTooltip(options: {
  unit: string
  fractionDigits: number
  valueLabel: string
  targetLabel: string
  dateLabel: (date: string) => string
}) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    const point = payload[0]?.payload as TrendPoint | undefined
    if (!active || !point) return null
    const format = (value: number) =>
      `${formatNumber(value, options.fractionDigits)} ${options.unit}`.trim()
    return (
      <TooltipBox>
        <p className="label-mono text-muted-foreground">{options.dateLabel(point.date)}</p>
        <p className="mt-1 text-foreground tabular-nums">
          {options.valueLabel}: {point.value === null ? '—' : format(point.value)}
        </p>
        {point.target !== undefined && point.target !== null && (
          <p className="text-foreground-secondary tabular-nums">
            {options.targetLabel}: {format(point.target)}
          </p>
        )}
        {point.note && <p className="label-mono text-muted-foreground">{point.note}</p>}
      </TooltipBox>
    )
  }
}

interface TrendChartProps {
  data: TrendPoint[]
  label: string
  summary: string
  unit: string
  valueLabel: string
  targetLabel?: string
  fractionDigits?: number
  height?: number
  /** Bars suit daily intake; a line with points suits sparse measurements. */
  variant?: 'bar' | 'line'
  /** Weekly data labels its x-axis by week start. */
  dateLabel?: (date: string) => string
}

/** Value over time, optionally against a date-specific target (a step line). */
export function TrendChart({
  data,
  label,
  summary,
  unit,
  valueLabel,
  targetLabel = 'Target',
  fractionDigits = 0,
  height = 220,
  variant = 'line',
  dateLabel = formatDayLabel,
}: TrendChartProps) {
  const hasTarget = data.some((point) => point.target !== undefined && point.target !== null)
  const Content = makeTooltip({ unit, fractionDigits, valueLabel, targetLabel, dateLabel })

  return (
    <ChartFrame label={label} summary={summary} height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...CHART_GRID_PROPS} />
        <XAxis
          dataKey="date"
          {...CHART_AXIS_PROPS}
          tickFormatter={(value: string) => formatShortDate(value)}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          {...CHART_AXIS_PROPS}
          width={44}
          domain={variant === 'line' ? ['auto', 'auto'] : [0, 'auto']}
          tickFormatter={(value: number) => formatNumber(value, fractionDigits)}
        />
        <Tooltip
          content={Content}
          cursor={{ stroke: CHART_COLORS.grid, fill: 'var(--color-surface-2)', fillOpacity: 0.4 }}
          isAnimationActive={false}
        />
        {variant === 'bar' ? (
          <Bar
            dataKey="value"
            fill={CHART_COLORS.primary}
            maxBarSize={18}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        ) : (
          <Line
            dataKey="value"
            type="linear"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART_COLORS.primary, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        )}
        {hasTarget && (
          <Line
            dataKey="target"
            type="stepAfter"
            stroke={CHART_COLORS.target}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  )
}
