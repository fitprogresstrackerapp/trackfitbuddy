/**
 * Calendar-date helpers. Dates are ISO strings (YYYY-MM-DD) in the user's
 * own timezone — never derived from UTC.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Today's date in an IANA timezone, e.g. todayInTimeZone('Asia/Kolkata') → '2026-09-28'. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** True for a real calendar date in ISO form (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  if (y === undefined || m === undefined || d === undefined) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function toUtcDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Calendar arithmetic on ISO dates (timezone-free). */
export function addDays(iso: string, days: number): string {
  const date = toUtcDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

/**
 * The Monday–Sunday calendar week containing `iso` (spec §17: weeks are
 * strictly Monday → Sunday, never rolling 7-day windows).
 */
export function calendarWeekOf(iso: string): { start: string; end: string } {
  const weekday = toUtcDate(iso).getUTCDay() // 0 = Sunday … 6 = Saturday
  const start = addDays(iso, weekday === 0 ? -6 : 1 - weekday)
  return { start, end: addDays(start, 6) }
}

/** "MON 21 SEP" — compact date label for an ISO date (spec §9). */
export function formatDayLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(toUtcDate(iso))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`.toUpperCase()
}

/** "SEP 5" — short date for inline metadata. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(toUtcDate(iso))
    .toUpperCase()
}

/** Hour of day (0–23) in an IANA timezone. */
export function hourInTimeZone(timeZone: string, now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now),
  )
}

/** Completed years between two ISO dates. */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by = 0, bm = 0, bd = 0] = dateOfBirth.split('-').map(Number)
  const [ty = 0, tm = 0, td = 0] = onDate.split('-').map(Number)
  const hadBirthday = tm > bm || (tm === bm && td >= bd)
  return ty - by - (hadBirthday ? 0 : 1)
}

/** Project default (matches the profiles.timezone column default). */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/**
 * The profile timezone if the runtime recognises it, otherwise the project
 * default. The database already validates timezones; this guards display code.
 */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return DEFAULT_TIMEZONE
  }
}
