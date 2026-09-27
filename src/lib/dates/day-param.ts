import { addDays, isValidIsoDate } from './local-date'

/*
 * The `?date=` convention shared by dated logging pages (Food, Workout).
 * Records can be logged for today; a missing past day can be added up to
 * LATE_ENTRY_DAYS back (mirrored by log_meal / log_workout / log_activity);
 * future dates are never offered.
 */

/** How far back a missing record can be added (mirrors the database functions). */
export const LATE_ENTRY_DAYS = 90

export type DayKind = { kind: 'today' } | { kind: 'past'; lateEntry: boolean } | { kind: 'future' }

/** What the viewed day allows: today = full logging; past = late entry only. */
export function dayKind(date: string, today: string): DayKind {
  if (date === today) return { kind: 'today' }
  if (date > today) return { kind: 'future' }
  return { kind: 'past', lateEntry: date >= addDays(today, -LATE_ENTRY_DAYS) }
}

/**
 * The `?date=` parameter, validated. Missing, malformed or future dates fall
 * back to today (nothing can be logged ahead of time).
 */
export function resolveDateParam(
  raw: string | null,
  today: string,
): { date: string; valid: boolean } {
  if (raw === null) return { date: today, valid: true }
  if (!isValidIsoDate(raw) || raw > today) return { date: today, valid: false }
  return { date: raw, valid: true }
}
