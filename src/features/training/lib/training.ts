import { z } from 'zod'

import type {
  CalorieRates,
  GuidanceSession,
  TrainingKind,
  TrainingPlan,
  TrainingRecord,
} from '../types.ts'

/*
 * Training rules shared by Home and Workout (spec §14–18). Pure functions;
 * the database is authoritative for stored calories, locking and ownership.
 */

/** Distinct days (up to and including today) with at least one valid workout. */
export function countWorkoutDays(workoutDates: readonly string[], today: string): number {
  return new Set(workoutDates.filter((date) => date <= today)).size
}

/**
 * True when the recommendation cycle began after this week's Monday: a
 * transition week, not judged as a full target week (spec §17).
 */
export function isTransitionWeek(
  cycle: { periodStart: string } | null,
  week: { start: string; end: string },
): boolean {
  return Boolean(cycle && cycle.periodStart > week.start && cycle.periodStart <= week.end)
}

/** The next template session: sessions are done in order, on any days (spec §16). */
export function nextSession<T>(sessions: readonly T[], workoutDaysThisWeek: number): T | null {
  if (sessions.length === 0 || workoutDaysThisWeek >= sessions.length) return null
  return sessions[workoutDaysThisWeek] ?? null
}

export type CapacityStatus =
  | { kind: 'no-capacity' }
  | { kind: 'partial'; done: number; capacity: number }
  | { kind: 'remaining'; done: number; capacity: number; remaining: number }
  | { kind: 'met'; done: number; capacity: number }

/**
 * Weekly workout capacity (spec §16–17). Any valid workout counts, whatever
 * its type — the AI template is guidance, never the measure.
 */
export function capacityStatus(
  done: number,
  capacity: number | null,
  transition: boolean,
): CapacityStatus {
  if (capacity === null) return { kind: 'no-capacity' }
  if (done >= capacity) return { kind: 'met', done, capacity }
  if (transition) return { kind: 'partial', done, capacity }
  return { kind: 'remaining', done, capacity, remaining: capacity - done }
}

/*
 * Recommended workout template (recommendation_cycles.workout_plan_json). The
 * JSON contract belongs to the recommendation engine; only `sessions[]` is
 * read: plain names or objects with a name and optional duration/focus.
 */
const sessionSchema = z.union([
  z.string().min(1),
  z.looseObject({
    name: z.string().min(1),
    duration_minutes: z.number().positive().optional(),
    focus: z.string().min(1).optional(),
  }),
])
const planSchema = z.looseObject({ sessions: z.array(z.unknown()) })

export function parseWorkoutPlan(plan: unknown): GuidanceSession[] {
  const parsed = planSchema.safeParse(plan)
  if (!parsed.success) return []
  return parsed.data.sessions.flatMap((raw) => {
    const session = sessionSchema.safeParse(raw)
    if (!session.success) return []
    return typeof session.data === 'string'
      ? [{ name: session.data, durationMinutes: null, focus: null }]
      : [
          {
            name: session.data.name,
            durationMinutes: session.data.duration_minutes ?? null,
            focus: session.data.focus ?? null,
          },
        ]
  })
}

export type Guidance =
  | { kind: 'none' }
  | { kind: 'next'; session: GuidanceSession; index: number; total: number }
  | { kind: 'capacity-met' }
  | { kind: 'template-done' }

/** What to suggest next this week. Never invented without a recommendation. */
export function workoutGuidance(plan: TrainingPlan | null, workoutDaysThisWeek: number): Guidance {
  if (!plan?.cycle || plan.cycle.sessions.length === 0) return { kind: 'none' }
  if (plan.capacity !== null && workoutDaysThisWeek >= plan.capacity) {
    return { kind: 'capacity-met' }
  }
  const session = nextSession(plan.cycle.sessions, workoutDaysThisWeek)
  if (!session) return { kind: 'template-done' }
  return {
    kind: 'next',
    session,
    index: workoutDaysThisWeek,
    total: plan.cycle.sessions.length,
  }
}

/**
 * Preview of the database estimate: duration × rate for the type (else the
 * kind's default), rounded to 0.1 kcal — the same formula the trigger stores.
 */
export function estimateCalories(
  rates: CalorieRates,
  kind: TrainingKind,
  type: string,
  durationMinutes: number,
): number | null {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null
  const table = rates[kind]
  const rate = table[type] ?? table.default
  if (rate === undefined) return null
  return Math.round(durationMinutes * rate * 10) / 10
}

/** Only today's unlocked records can be changed (the database enforces the same). */
export function isEditable(
  record: Pick<TrainingRecord, 'date' | 'isLocked'>,
  today: string,
): boolean {
  return record.date === today && !record.isLocked
}

export interface TrainingTotals {
  sessions: number
  minutes: number
  calories: number
}

/** Sums; `null` when nothing is logged (never zeros for missing data). */
export function trainingTotals(records: readonly TrainingRecord[]): TrainingTotals | null {
  if (records.length === 0) return null
  return {
    sessions: records.length,
    minutes: records.reduce((sum, record) => sum + record.durationMinutes, 0),
    calories: Math.round(records.reduce((sum, record) => sum + record.finalCalories, 0)),
  }
}

/** "45 min", "1h 30m", "3h" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`
}

/** Records grouped by date, newest day first; records within a day oldest first. */
export function groupByDate(records: readonly TrainingRecord[]): [string, TrainingRecord[]][] {
  const groups = new Map<string, TrainingRecord[]>()
  for (const record of records) {
    const list = groups.get(record.date) ?? []
    list.push(record)
    groups.set(record.date, list)
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a))
}

const KNOWN_ERRORS: readonly [RegExp, string][] = [
  [/future date/i, 'Workouts and activities can’t be logged for a future date.'],
  [/last \d+ days only/i, 'Missing entries can only be added for the last 90 days.'],
]

/**
 * User-facing error text. Never shows raw database messages; unknown failures
 * get `fallback`, which names the action.
 */
export function friendlyTrainingError(error: unknown, fallback: string): string {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network/i.test(error.message))
  ) {
    return 'Couldn’t reach the server. Check your connection and try again.'
  }
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (typeof message === 'string') {
      const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(message))
      if (known) return known[1]
    }
    if (code === '42501') return 'This record is locked. Past entries can’t be changed.'
    if (code === '23514') return 'Check the values — something is outside the allowed range.'
  }
  return fallback
}
