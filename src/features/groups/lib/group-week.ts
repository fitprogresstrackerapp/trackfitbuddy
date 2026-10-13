import type { DailyTargets } from '@/features/nutrition/types'
import {
  stepsSummary,
  summarizeNutrition,
  weeklyTraining,
  type Adherence,
  type NutritionPoint,
  type WeekStatus,
} from '@/features/progress/lib/progress-logic'
import type { Period } from '@/features/progress/types'
import { addDays, calendarWeekOf } from '@/lib/dates/local-date'
import { formatNumber, NO_VALUE } from '@/lib/format'

import type { GroupRole, MemberWeekDay } from '../api/groups-data'

/*
 * The Groups weekly view (docs/groups.md): one Monday–Sunday week of the same
 * group-visible information the daily cards show, summarised with the
 * existing Progress rules. Nothing here is a new definition:
 *   nutrition → summarizeNutrition (calories within the day's range)
 *   protein   → summarizeNutrition (protein target met)
 *   workouts  → weeklyTraining (distinct workout days; capacity in force)
 *   steps     → stepsSummary (average of days with an active entry)
 * The database returns only the days each member may count (from the day they
 * joined, never after today), so eligibility is decided there.
 *
 * Groups are for shared accountability: nothing here ranks, scores or orders
 * members by how they are doing (spec §47).
 */

/** This week and the previous one, Monday–Sunday, in the user's calendar. */
export function groupWeeks(today: string): { current: Period; previous: Period } {
  const current = calendarWeekOf(today)
  return { current, previous: calendarWeekOf(addDays(current.start, -7)) }
}

export interface MemberWeek {
  userId: string
  name: string | null
  role: GroupRole
  /** The first day of the week this member counts from (their join day, or Monday). */
  firstDay: string
  /** Calories within the day's range, over eligible tracked days. */
  nutrition: Adherence
  /** Protein target met, over eligible tracked days. */
  protein: Adherence
  workouts: { done: number; capacity: number | null; status: WeekStatus }
  /** Steps per day with an entry; `null` without any entry. */
  steps: { average: number; days: number } | null
  /** Days with something logged, for the participation counts. */
  loggedDays: { nutrition: number; workout: number; steps: number }
}

/** A day's targets in the shape the shared rules read. Only calories and protein are shared. */
function dayTargets(day: MemberWeekDay): DailyTargets | null {
  if (day.caloriesTarget === null || day.proteinTargetG === null) return null
  return {
    calories: day.caloriesTarget,
    proteinG: day.proteinTargetG,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    workoutsPerWeek: day.workoutsPerWeek ?? 0,
    tolerance: day.tolerance,
    source: day.tolerance ? 'snapshot' : 'cycle',
  }
}

/** Each member's week. Members come back in the order of `days` (name order from the server). */
export function memberWeeks(
  days: readonly MemberWeekDay[],
  week: Period,
  today: string,
): MemberWeek[] {
  const byMember = new Map<string, MemberWeekDay[]>()
  for (const day of days) {
    const list = byMember.get(day.userId) ?? []
    list.push(day)
    byMember.set(day.userId, list)
  }

  return [...byMember.values()].flatMap((rows) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0]
    if (!first) return []
    const targets = new Map(sorted.map((day) => [day.date, dayTargets(day)]))
    const points: NutritionPoint[] = sorted.map((day) => ({
      date: day.date,
      // Only calories and protein are group-visible; the other nutrients stay unknown.
      actual: {
        calories: day.calories,
        proteinG: day.proteinG,
        carbsG: null,
        fatG: null,
        fiberG: null,
      },
      target: {
        calories: day.caloriesTarget,
        proteinG: day.proteinTargetG,
        carbsG: null,
        fatG: null,
        fiberG: null,
      },
    }))
    const nutrition = summarizeNutrition(points, targets, today)
    const cycles = [
      ...new Set(sorted.flatMap((day) => (day.cycleStart ? [day.cycleStart] : []))),
    ].map((periodStart) => ({ periodStart }))
    // The weekly capacity in force, kept apart so a missing one stays missing.
    const capacities = new Map(
      sorted.map((day) => [
        day.date,
        day.workoutsPerWeek === null ? null : { workoutsPerWeek: day.workoutsPerWeek },
      ]),
    )
    const [training] = weeklyTraining(
      week,
      sorted.filter((day) => day.workoutLogged).map((day) => ({ date: day.date })),
      capacities,
      cycles,
      today,
    )
    const stepDays = sorted.flatMap((day) =>
      day.steps === null ? [] : [{ date: day.date, steps: day.steps }],
    )
    return [
      {
        userId: first.userId,
        name: first.name,
        role: first.role,
        firstDay: first.date,
        nutrition: nutrition.nutrients.calories.adherence,
        protein: nutrition.nutrients.proteinG.adherence,
        workouts: {
          done: training?.done ?? 0,
          capacity: training?.capacity ?? null,
          status: training?.status ?? 'no-capacity',
        },
        steps: stepsSummary(stepDays),
        loggedDays: {
          nutrition: sorted.filter((day) => day.calories !== null).length,
          workout: sorted.filter((day) => day.workoutLogged).length,
          steps: stepDays.length,
        },
      },
    ]
  })
}

/**
 * Neutral order (spec §47: no ranking): you first, then everyone else by
 * name. Never by any metric.
 */
export function neutralOrder<T extends { userId: string; name: string | null }>(
  members: readonly T[],
  myUserId: string,
): T[] {
  return [...members].sort((a, b) => {
    if (a.userId === myUserId) return -1
    if (b.userId === myUserId) return 1
    return (
      (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }) ||
      a.userId.localeCompare(b.userId)
    )
  })
}

/**
 * Group participation for the week: how many members logged anything, and
 * each kind of entry. Counts only; nothing says who did better.
 * "Active" = at least one day with logged food, a workout or a steps entry
 * (the group-visible kinds of tracking).
 */
export function participation(weeks: readonly MemberWeek[]): {
  members: number
  active: number
  nutrition: number
  workout: number
  steps: number
} {
  const count = (test: (week: MemberWeek) => boolean) => weeks.filter(test).length
  return {
    members: weeks.length,
    active: count(
      (week) =>
        week.loggedDays.nutrition > 0 || week.loggedDays.workout > 0 || week.loggedDays.steps > 0,
    ),
    nutrition: count((week) => week.loggedDays.nutrition > 0),
    workout: count((week) => week.loggedDays.workout > 0),
    steps: count((week) => week.loggedDays.steps > 0),
  }
}

export interface WeekChange {
  /** Percentage points; `null` when either week has no value. */
  nutrition: number | null
  protein: number | null
  /** Workout days. */
  workouts: number | null
  /** Steps per day. */
  steps: number | null
}

/** Your week against your previous week. Only where both weeks have a value; never invented. */
export function weekChange(current: MemberWeek | null, previous: MemberWeek | null): WeekChange {
  const points = (a: number | null | undefined, b: number | null | undefined) =>
    a === null || a === undefined || b === null || b === undefined
      ? null
      : Math.round(a * 100) - Math.round(b * 100)
  return {
    nutrition: points(current?.nutrition.rate, previous?.nutrition.rate),
    protein: points(current?.protein.rate, previous?.protein.rate),
    workouts:
      current &&
      previous &&
      current.workouts.capacity !== null &&
      previous.workouts.capacity !== null
        ? current.workouts.done - previous.workouts.done
        : null,
    steps:
      current?.steps && previous?.steps ? current.steps.average - previous.steps.average : null,
  }
}

/** "7.4k/day"; "—" without any entry (no step goal exists, spec Phase 1). */
export function formatStepsPerDay(steps: MemberWeek['steps']): string {
  if (!steps) return NO_VALUE
  const value =
    steps.average >= 1000
      ? `${formatNumber(steps.average / 1000, 1)}k`
      : formatNumber(steps.average)
  return `${value}/day`
}

/** "3 / 4"; just the count when no capacity is in force, and "—" when that count is 0. */
export function formatWorkouts(workouts: MemberWeek['workouts']): string {
  if (workouts.capacity === null) {
    // Without a plan, nothing logged is no data, not a failure.
    return workouts.done === 0 ? NO_VALUE : String(workouts.done)
  }
  return `${String(workouts.done)} / ${String(workouts.capacity)}`
}
