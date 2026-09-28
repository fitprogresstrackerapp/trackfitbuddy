import { evaluateCalories, evaluateNutrient } from '@/features/nutrition/lib/nutrition'
import { resolveTargets } from '@/features/nutrition/lib/targets'
import type { DailyTargets } from '@/features/nutrition/types'
import { countWorkoutDays, isTransitionWeek } from '@/features/training/lib/training'
import { addDays, addMonths, calendarWeekOf } from '@/lib/dates/local-date'

import type {
  BodyPeriodData,
  CompositionMeasurement,
  CycleInfo,
  DayNutrition,
  Period,
  RangeKey,
  SnapshotInfo,
  StepsDay,
  TrainingEntry,
  WeightMeasurement,
} from '../types'

/*
 * Deterministic Progress calculations (spec §26–28, §44). Pure functions over
 * records the database already filtered (RLS, soft deletion). Missing data is
 * never turned into zero: absent days stay absent, empty results are `null`.
 */

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export const RANGE_KEYS: readonly RangeKey[] = ['7D', '30D', '3M', '6M', '1Y']
export const DEFAULT_RANGE: RangeKey = '30D'

export function isRangeKey(value: string | null): value is RangeKey {
  return value !== null && (RANGE_KEYS as readonly string[]).includes(value)
}

/**
 * The selected range, ending today (inclusive), in the user's calendar:
 *   7D / 30D  → today and the previous 6 / 29 days
 *   3M/6M/1Y  → the 3 / 6 / 12 calendar months ending today: from the day
 *               after the same date n months earlier (month-end clamped).
 */
export function rangePeriod(key: RangeKey, today: string): Period {
  switch (key) {
    case '7D':
      return { start: addDays(today, -6), end: today }
    case '30D':
      return { start: addDays(today, -29), end: today }
    case '3M':
      return { start: addDays(addMonths(today, -3), 1), end: today }
    case '6M':
      return { start: addDays(addMonths(today, -6), 1), end: today }
    case '1Y':
      return { start: addDays(addMonths(today, -12), 1), end: today }
  }
}

export function datesIn(period: Period): string[] {
  const dates: string[] = []
  for (let date = period.start; date <= period.end; date = addDays(date, 1)) dates.push(date)
  return dates
}

// ---------------------------------------------------------------------------
// Historical targets
// ---------------------------------------------------------------------------

/** The cycle covering a date (latest start wins), if any. */
export function cycleOn(cycles: readonly CycleInfo[], date: string): CycleInfo | null {
  let found: CycleInfo | null = null
  for (const cycle of cycles) {
    if (cycle.periodStart <= date && (cycle.periodEnd === null || cycle.periodEnd >= date)) {
      if (!found || cycle.periodStart > found.periodStart) found = cycle
    }
  }
  return found
}

/**
 * The target in force on each date (spec §26): that date's snapshot, else the
 * covering cycle's final values (no tolerance), else none. Never today's target
 * applied to the past.
 */
export function targetsByDate(
  dates: readonly string[],
  snapshots: readonly SnapshotInfo[],
  cycles: readonly CycleInfo[],
): Map<string, DailyTargets | null> {
  const byDate = new Map(snapshots.map((snapshot) => [snapshot.target_date, snapshot]))
  return new Map(
    dates.map((date) => [date, resolveTargets(byDate.get(date) ?? null, cycleOn(cycles, date))]),
  )
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export type NutrientKey = 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'

export interface NutritionPoint {
  date: string
  /** `null` = nothing logged that day (a gap, never zero). */
  actual: Record<NutrientKey, number | null>
  target: Record<NutrientKey, number | null>
}

export function nutritionSeries(
  period: Period,
  days: readonly DayNutrition[],
  targets: Map<string, DailyTargets | null>,
): NutritionPoint[] {
  const logged = new Map(days.map((day) => [day.date, day]))
  return datesIn(period).map((date) => {
    const day = logged.get(date)
    const target = targets.get(date) ?? null
    return {
      date,
      actual: {
        calories: day?.calories ?? null,
        proteinG: day?.proteinG ?? null,
        carbsG: day?.carbsG ?? null,
        fatG: day?.fatG ?? null,
        fiberG: day?.fiberG ?? null,
      },
      target: {
        calories: target?.calories ?? null,
        proteinG: target?.proteinG ?? null,
        carbsG: target?.carbsG ?? null,
        fatG: target?.fatG ?? null,
        fiberG: target?.fiberG ?? null,
      },
    }
  })
}

export interface Adherence {
  met: number
  /** Eligible tracked days (the denominator). */
  eligible: number
  /** met / eligible; `null` when no day is eligible. */
  rate: number | null
}

export interface NutrientSummary {
  /** Average over tracked, completed days; `null` without any. */
  averageActual: number | null
  averageTarget: number | null
  adherence: Adherence
}

export interface NutritionSummary {
  /** Completed days in the period with at least one logged food. */
  trackedDays: number
  nutrients: Record<NutrientKey, NutrientSummary>
}

const NUTRIENTS: readonly NutrientKey[] = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG']

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function adherence(met: number, eligible: number): Adherence {
  return { met, eligible, rate: eligible === 0 ? null : met / eligible }
}

/**
 * Nutrition adherence (spec §27–28) = days meeting target / eligible tracked
 * days. A day is eligible when it is complete (before today), has at least
 * one logged food, and has a target snapshot with its tolerance. Days without
 * food are not failures; they are simply not tracked.
 *   calories: target × lower ≤ actual ≤ target × upper
 *   others:   actual ≥ target × nutrient tolerance
 */
export function summarizeNutrition(
  points: readonly NutritionPoint[],
  targets: Map<string, DailyTargets | null>,
  today: string,
): NutritionSummary {
  const tracked = points.filter((point) => point.date < today && point.actual.calories !== null)

  const nutrients = Object.fromEntries(
    NUTRIENTS.map((key) => {
      let met = 0
      let eligible = 0
      for (const point of tracked) {
        const target = targets.get(point.date)
        const actual = point.actual[key]
        if (!target?.tolerance || actual === null) continue
        const status =
          key === 'calories'
            ? evaluateCalories(actual, target.calories, target.tolerance)
            : evaluateNutrient(actual, target[key], target.tolerance)
        eligible += 1
        if (status === 'within' || status === 'met') met += 1
      }
      const actuals = tracked.flatMap((point) => {
        const value = point.actual[key]
        return value === null ? [] : [value]
      })
      const targetsOnTracked = tracked.flatMap((point) => {
        const value = point.target[key]
        return value === null ? [] : [value]
      })
      return [
        key,
        {
          averageActual: average(actuals),
          averageTarget: average(targetsOnTracked),
          adherence: adherence(met, eligible),
        },
      ]
    }),
  ) as Record<NutrientKey, NutrientSummary>

  return { trackedDays: tracked.length, nutrients }
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type WeekStatus = 'counted' | 'partial' | 'in-progress' | 'no-capacity'

export interface WeekSummary {
  start: string
  end: string
  /** Distinct workout days (shared Home/Workout rule). */
  done: number
  capacity: number | null
  status: WeekStatus
}

/** Monday–Sunday weeks overlapping the period. */
export function weeksOverlapping(period: Period): Period[] {
  const weeks: Period[] = []
  for (
    let start = calendarWeekOf(period.start).start;
    start <= period.end;
    start = addDays(start, 7)
  ) {
    weeks.push({ start, end: addDays(start, 6) })
  }
  return weeks
}

/**
 * Weekly workout completion (spec §16–17). Uses the shared countWorkoutDays /
 * isTransitionWeek rules; workout type never matters. The capacity of a week
 * is the one in force on its last elapsed day.
 */
export function weeklyTraining(
  period: Period,
  workouts: readonly TrainingEntry[],
  targets: Map<string, DailyTargets | null>,
  cycles: readonly CycleInfo[],
  today: string,
): WeekSummary[] {
  return weeksOverlapping(period).map((week) => {
    const dates = workouts
      .filter((workout) => workout.date >= week.start && workout.date <= week.end)
      .map((workout) => workout.date)
    const done = countWorkoutDays(dates, today)
    const lastDay = week.end < today ? week.end : today
    const capacity = targets.get(lastDay)?.workoutsPerWeek ?? null
    const partial = cycles.some((cycle) => isTransitionWeek(cycle, week))
    const status: WeekStatus =
      capacity === null
        ? 'no-capacity'
        : partial
          ? 'partial'
          : week.end >= today
            ? 'in-progress'
            : 'counted'
    return { start: week.start, end: week.end, done, capacity, status }
  })
}

/**
 * Workout adherence over completed full weeks: Σ min(done, capacity) /
 * Σ capacity. Partial (transition) weeks, the week in progress and weeks
 * without a capacity are excluded; extra workouts never offset another week.
 */
export function workoutAdherence(weeks: readonly WeekSummary[]): {
  done: number
  expected: number
  weeks: number
  rate: number | null
} {
  const counted = weeks.filter((week) => week.status === 'counted' && week.capacity !== null)
  const done = counted.reduce((sum, week) => sum + Math.min(week.done, week.capacity ?? 0), 0)
  const expected = counted.reduce((sum, week) => sum + (week.capacity ?? 0), 0)
  return { done, expected, weeks: counted.length, rate: expected === 0 ? null : done / expected }
}

export interface EntryTotals {
  sessions: number
  /** Distinct dates with an entry. */
  days: number
  minutes: number
  calories: number
  averageMinutes: number
}

/** Totals within the period; `null` when nothing was logged (not zeros). */
export function entryTotals(entries: readonly TrainingEntry[], period: Period): EntryTotals | null {
  const inPeriod = entries.filter((entry) => entry.date >= period.start && entry.date <= period.end)
  if (inPeriod.length === 0) return null
  const minutes = inPeriod.reduce((sum, entry) => sum + entry.durationMinutes, 0)
  return {
    sessions: inPeriod.length,
    days: new Set(inPeriod.map((entry) => entry.date)).size,
    minutes,
    calories: Math.round(inPeriod.reduce((sum, entry) => sum + entry.calories, 0)),
    averageMinutes: Math.round(minutes / inPeriod.length),
  }
}

/** Minutes per Monday–Sunday week (activity trend); weeks without entries are `null`. */
export function weeklyMinutes(
  entries: readonly TrainingEntry[],
  period: Period,
): { start: string; minutes: number | null }[] {
  return weeksOverlapping(period).map((week) => {
    const inWeek = entries.filter(
      (entry) =>
        entry.date >= week.start &&
        entry.date <= week.end &&
        entry.date >= period.start &&
        entry.date <= period.end,
    )
    return {
      start: week.start,
      minutes:
        inWeek.length === 0 ? null : inWeek.reduce((sum, entry) => sum + entry.durationMinutes, 0),
    }
  })
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export interface WeightPoint {
  date: string
  weightKg: number
  source: WeightMeasurement['source']
}

/**
 * One weight per measured date, using the existing precedence (the
 * current_weights rule): InBody over manual on the same date, else the latest
 * entry. Other entries stay in the record; nothing is interpolated.
 */
export function weightSeries(measurements: readonly WeightMeasurement[]): WeightPoint[] {
  const byDate = new Map<string, WeightMeasurement>()
  for (const measurement of measurements) {
    const current = byDate.get(measurement.date)
    const better =
      !current ||
      (measurement.source === 'INBODY' && current.source !== 'INBODY') ||
      (measurement.source === current.source && measurement.createdAt > current.createdAt)
    if (better) byDate.set(measurement.date, measurement)
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, weightKg, source }) => ({ date, weightKg, source }))
}

export interface Change {
  first: { date: string; value: number }
  last: { date: string; value: number }
  /** last − first; `null` with a single measurement. */
  delta: number | null
}

/** Earliest → latest observed value; `null` without data. Never interpolated. */
export function change(points: readonly { date: string; value: number | null }[]): Change | null {
  const valid = points
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  const first = valid[0]
  const last = valid[valid.length - 1]
  if (!first || !last) return null
  return {
    first,
    last,
    delta: valid.length > 1 ? Math.round((last.value - first.value) * 100) / 100 : null,
  }
}

export function compositionSeries(
  measurements: readonly CompositionMeasurement[],
  key: 'bodyFatPercent' | 'muscleMassKg',
): { date: string; value: number }[] {
  return measurements
    .flatMap((measurement) => {
      const value = measurement[key]
      return value === null ? [] : [{ date: measurement.date, value }]
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** True when the period has any weight or InBody measurement. */
export function hasBodyData(data: BodyPeriodData | undefined): boolean {
  return Boolean(data && (data.weights.length > 0 || data.composition.length > 0))
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Average of days with an entry (no entry ≠ 0 steps, spec §68). */
export function stepsSummary(days: readonly StepsDay[]): { average: number; days: number } | null {
  if (days.length === 0) return null
  return {
    average: Math.round(days.reduce((sum, day) => sum + day.steps, 0) / days.length),
    days: days.length,
  }
}

// ---------------------------------------------------------------------------
// Goals and cycles
// ---------------------------------------------------------------------------

/**
 * Progress from start toward target, 0–1, for a goal with a numeric target.
 * Works in either direction (loss or gain). `null` without start/target, or
 * when start equals target: no percentage is ever invented.
 */
export function goalProgress(
  start: number | null,
  current: number | null,
  target: number | null,
): number | null {
  if (start === null || current === null || target === null || start === target) return null
  const progress = (current - start) / (target - start)
  return Math.min(1, Math.max(0, progress))
}

/** The analysed part of a cycle: its start until today (or its end, if earlier). */
export function cyclePeriod(
  cycle: Pick<CycleInfo, 'periodStart' | 'periodEnd'>,
  today: string,
): Period {
  const end = cycle.periodEnd !== null && cycle.periodEnd < today ? cycle.periodEnd : today
  return { start: cycle.periodStart, end }
}
