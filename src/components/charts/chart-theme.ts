/**
 * Shared Recharts styling derived from design tokens (see styles/globals.css).
 * Charts must take colours from here — never raw hex values.
 */
export const CHART_COLORS = {
  primary: 'var(--color-chart-1)',
  secondary: 'var(--color-chart-2)',
  warning: 'var(--color-chart-3)',
  target: 'var(--color-chart-target)',
  grid: 'var(--color-chart-grid)',
  axis: 'var(--color-muted-foreground)',
} as const

/** Common axis props: quiet, monospace ticks, no axis lines. */
export const CHART_AXIS_PROPS = {
  stroke: CHART_COLORS.axis,
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fontFamily: 'var(--font-mono)', fill: CHART_COLORS.axis },
} as const

export const CHART_GRID_PROPS = {
  stroke: CHART_COLORS.grid,
  strokeDasharray: '2 4',
  vertical: false,
} as const
