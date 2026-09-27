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

/** Completed years between two ISO dates. */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by = 0, bm = 0, bd = 0] = dateOfBirth.split('-').map(Number)
  const [ty = 0, tm = 0, td = 0] = onDate.split('-').map(Number)
  const hadBirthday = tm > bm || (tm === bm && td >= bd)
  return ty - by - (hadBirthday ? 0 : 1)
}
