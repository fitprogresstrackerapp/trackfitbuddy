import type { StepEntry } from '../api/profile-data'

/*
 * Pure Profile rules. The database is authoritative for readiness, locking
 * and review windows; these helpers decide what the page shows and offers.
 */

/** Labels for the required fields reported by the profile_readiness view. */
export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  date_of_birth: 'Date of birth',
  gender: 'Gender',
  height_cm: 'Height',
  current_weight: 'Current weight',
}

export function missingFieldLabels(missing: readonly string[]): string[] {
  return missing.map((field) => REQUIRED_FIELD_LABELS[field] ?? field)
}

/** Weight and step records can be changed on their own day only (the guard enforces the same). */
export function isEditableDay(date: string, today: string): boolean {
  return date === today
}

export interface StepsDay {
  date: string
  /** The active (latest valid) entry — the day's value. Never a sum. */
  active: number | null
  entries: StepEntry[]
}

/**
 * Entries grouped by day, newest day first. The day's value is the active
 * entry (the database keeps exactly one); if none is marked active, the most
 * recent entry is used. Entries are never added together.
 */
export function stepsByDay(entries: readonly StepEntry[]): StepsDay[] {
  const days = new Map<string, StepEntry[]>()
  for (const entry of entries) {
    const list = days.get(entry.date) ?? []
    list.push(entry)
    days.set(entry.date, list)
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => {
      const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const active = sorted.find((entry) => entry.isActive) ?? sorted[0]
      return { date, active: active?.steps ?? null, entries: sorted }
    })
}

export type ReviewState =
  { kind: 'none' } | { kind: 'review'; until: string } | { kind: 'active'; since: string }

/**
 * User-facing recommendation status (spec §32): in review from generation
 * through the next calendar day, then active. A recommendation still marked
 * IN_REVIEW after its deadline is locked (auto-lock) — never shown as
 * editable. Processing states are admin-only and never appear here.
 */
export function reviewState(
  recommendation: {
    status: 'IN_REVIEW' | 'LOCKED'
    periodStart: string
    reviewDeadline: string
  } | null,
  today: string,
): ReviewState {
  if (!recommendation) return { kind: 'none' }
  if (recommendation.status === 'IN_REVIEW' && today <= recommendation.reviewDeadline) {
    return { kind: 'review', until: recommendation.reviewDeadline }
  }
  return { kind: 'active', since: recommendation.periodStart }
}

/** True when the final value differs from the AI recommendation. */
export function isEdited(recommended: number, final: number): boolean {
  return Math.abs(recommended - final) > 1e-9
}

const KNOWN_ERRORS: readonly [RegExp, string][] = [
  [/future/i, 'The date can’t be in the future.'],
  [/last \d+ days only/i, 'Missing entries can be added for the last 90 days only.'],
  [/review window has closed/i, 'The review window has closed. This recommendation is locked.'],
  [/outside the allowed ranges/i, 'Check the targets — one is outside the allowed range.'],
  [/template must have/i, 'The workout template must keep the same number of sessions.'],
  [/each focus at most once/i, 'Choose each focus at most once.'],
]

/**
 * User-facing error text; never raw database messages. Unknown failures get
 * `fallback`, which names the action.
 */
export function friendlyProfileError(error: unknown, fallback: string): string {
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
    if (code === '42501') return 'This record is locked and can no longer be changed.'
    if (code === 'P0002') return 'That record is no longer available.'
    if (code === '23514') return 'Check the values — one is outside the allowed range.'
  }
  return fallback
}
