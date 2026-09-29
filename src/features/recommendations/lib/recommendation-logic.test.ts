import { describe, expect, it } from 'vitest'

import type { OverviewUser } from '../api/admin-data'
import {
  checkInState,
  countStates,
  formatMoney,
  friendlyFeedbackError,
  historyLabel,
  readinessLines,
  stateReason,
} from './recommendation-logic'

const TODAY = '2026-10-05'

const user = (overrides: Partial<OverviewUser>): OverviewUser => ({
  userId: 'u',
  name: 'John',
  localDate: TODAY,
  processingMonth: '2026-10-01',
  missingFields: [],
  hasGoal: true,
  capacity: 4,
  lastRecommendation: null,
  latestAttemptAt: null,
  failureReason: null,
  skipReason: null,
  state: 'READY',
  ...overrides,
})

describe('admin readiness wording', () => {
  it('explains a ready first-time user', () => {
    expect(readinessLines(user({}))).toEqual([
      'Profile complete',
      'Goals configured',
      'Workout capacity 4 days / week',
      'No previous recommendation',
    ])
  })

  it('names what is missing for an incomplete user, never raw errors', () => {
    const alex = user({
      missingFields: ['height_cm', 'current_weight'],
      hasGoal: false,
      capacity: null,
      state: 'INCOMPLETE',
    })
    expect(stateReason(alex)).toBe(
      'Missing: Height, Current weight · No goals configured · No workout capacity configured',
    )
  })

  it('shows the concise failure or skip reason', () => {
    expect(stateReason(user({ state: 'FAILED', failureReason: 'Provider rate limit' }))).toBe(
      'Provider rate limit',
    )
    expect(stateReason(user({ state: 'SKIPPED', skipReason: 'Profile incomplete' }))).toBe(
      'Profile incomplete',
    )
    expect(stateReason(user({ state: 'SUCCESS' }))).toBeNull()
  })

  it('counts every state', () => {
    expect(
      countStates([user({}), user({ state: 'FAILED' }), user({ state: 'FAILED' })]),
    ).toMatchObject({ READY: 1, FAILED: 2, SUCCESS: 0, PENDING: 0 })
  })

  it('formats money in the configured currency', () => {
    expect(formatMoney(120.5, 'INR')).toBe('₹120.50')
    expect(formatMoney(3, 'USD')).toBe('$3.00')
    expect(formatMoney(null, 'INR')).toBe('—')
  })
})

describe('monthly check-in', () => {
  const base = {
    month: '2026-10-01',
    feedback: null,
    updatedAt: null,
    locked: false,
    processed: false,
  }

  it('is open until this month’s recommendation exists', () => {
    expect(checkInState(base)).toEqual({ kind: 'open' })
    expect(checkInState({ ...base, feedback: 'x', locked: true, processed: true })).toEqual({
      kind: 'used',
    })
    expect(checkInState({ ...base, processed: true })).toEqual({
      kind: 'closed',
      reopens: '2026-11-01',
    })
  })

  it('maps a closed window to a friendly message', () => {
    expect(
      friendlyFeedbackError({ code: '42501', message: 'new row violates row-level security' }),
    ).toBe('This month’s check-in is closed.')
    expect(friendlyFeedbackError({ code: 'XX000', message: 'boom' })).toBe(
      'Couldn’t save your check-in. Please try again.',
    )
  })
})

describe('recommendation history labels', () => {
  const item = (periodStart: string, periodEnd: string | null, status: 'IN_REVIEW' | 'LOCKED') => ({
    id: periodStart,
    periodStart,
    periodEnd,
    reviewDeadline:
      periodStart.slice(0, 8) + String(Number(periodStart.slice(8)) + 1).padStart(2, '0'),
    status,
  })

  it('the cycle covering today is in review or active; older ones are previous', () => {
    expect(historyLabel(item('2026-10-04', null, 'IN_REVIEW'), TODAY)).toBe('In review')
    expect(historyLabel(item('2026-10-02', null, 'IN_REVIEW'), TODAY)).toBe('Active')
    expect(historyLabel(item('2026-10-04', null, 'LOCKED'), TODAY)).toBe('Active')
    expect(historyLabel(item('2026-09-04', '2026-10-03', 'LOCKED'), TODAY)).toBe('Previous')
  })
})
