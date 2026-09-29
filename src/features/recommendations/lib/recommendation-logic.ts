import type { Status } from '@/components/data/status-badge'
import { missingFieldLabels } from '@/features/profile/lib/profile-logic'
import { addMonths, formatShortDate } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import type { OverviewUser, ProcessingState } from '../api/admin-data'
import type { HistoryItem, MonthlyFeedback } from '../api/recommendation-data'

/*
 * Pure display rules for recommendation screens (admin processing and the
 * user's check-in/history). No data access here.
 */

export const STATE_BADGES: Record<ProcessingState, { status: Status; label: string }> = {
  READY: { status: 'on-track', label: 'Ready' },
  INCOMPLETE: { status: 'incomplete', label: 'Incomplete' },
  PENDING: { status: 'pending', label: 'Pending' },
  PROCESSING: { status: 'pending', label: 'Processing' },
  SUCCESS: { status: 'completed', label: 'Success' },
  FAILED: { status: 'failed', label: 'Failed' },
  SKIPPED: { status: 'locked', label: 'Skipped' },
}

export function countStates(users: readonly OverviewUser[]): Record<ProcessingState, number> {
  const counts: Record<ProcessingState, number> = {
    READY: 0,
    INCOMPLETE: 0,
    PENDING: 0,
    PROCESSING: 0,
    SUCCESS: 0,
    FAILED: 0,
    SKIPPED: 0,
  }
  for (const user of users) counts[user.state] += 1
  return counts
}

/**
 * Why a user is (not) ready, in plain words (Prompt 10 §84). Never raw
 * validation errors and never body metrics.
 */
export function readinessLines(user: OverviewUser): string[] {
  const lines: string[] = []
  if (user.missingFields.length > 0) {
    lines.push(`Missing: ${missingFieldLabels(user.missingFields).join(', ')}`)
  } else {
    lines.push('Profile complete')
  }
  lines.push(user.hasGoal ? 'Goals configured' : 'No goals configured')
  lines.push(
    user.capacity === null
      ? 'No workout capacity configured'
      : `Workout capacity ${String(user.capacity)} days / week`,
  )
  lines.push(
    user.lastRecommendation
      ? `Last recommendation ${formatShortDate(user.lastRecommendation)}`
      : 'No previous recommendation',
  )
  return lines
}

/** The one-line reason shown next to the state. */
export function stateReason(user: OverviewUser): string | null {
  switch (user.state) {
    case 'FAILED':
      return user.failureReason
    case 'SKIPPED':
      return user.skipReason
    case 'INCOMPLETE':
      return readinessLines(user)
        .filter(
          (line) =>
            line.startsWith('Missing') ||
            line.startsWith('No goals') ||
            line.startsWith('No workout'),
        )
        .join(' · ')
    default:
      return null
  }
}

/** Money in the configured currency; never a hard-coded symbol. */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${formatNumber(value, 2)} ${currency}`
  }
}

export type CheckInState = { kind: 'open' } | { kind: 'used' } | { kind: 'closed'; reopens: string }

/**
 * The check-in is open from the 1st until this month's recommendation is
 * generated (the server is authoritative); afterwards it is kept read-only.
 */
export function checkInState(feedback: MonthlyFeedback): CheckInState {
  if (feedback.locked) return { kind: 'used' }
  if (feedback.processed) return { kind: 'closed', reopens: addMonths(feedback.month, 1) }
  return { kind: 'open' }
}

export type HistoryLabel = 'In review' | 'Active' | 'Previous'

/** User-facing history label: the cycle covering today is current. */
export function historyLabel(item: HistoryItem, today: string): HistoryLabel {
  const current = item.periodStart <= today && (item.periodEnd === null || item.periodEnd >= today)
  if (!current) return 'Previous'
  return item.status === 'IN_REVIEW' && today <= item.reviewDeadline ? 'In review' : 'Active'
}

const FEEDBACK_ERRORS: readonly [RegExp, string][] = [
  [/window .* closed|row-level security/i, 'This month’s check-in is closed.'],
]

export function friendlyFeedbackError(error: unknown): string {
  if (error instanceof TypeError)
    return 'Couldn’t reach the server. Check your connection and try again.'
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  const known = FEEDBACK_ERRORS.find(([pattern]) => pattern.test(message))
  if (known) return known[1]
  if (code === '42501') return 'This month’s check-in is closed.'
  return 'Couldn’t save your check-in. Please try again.'
}
