import { describe, expect, it } from 'vitest'

import { ageOn } from '@/lib/dates/local-date'

import type { StepEntry } from '../api/profile-data'
import {
  friendlyProfileError,
  isEdited,
  isEditableDay,
  missingFieldLabels,
  reviewState,
  stepsByDay,
} from './profile-logic'

const TODAY = '2026-09-29'

function entry(overrides: Partial<StepEntry>): StepEntry {
  return {
    id: 'e',
    date: TODAY,
    steps: 1000,
    isActive: false,
    createdAt: `${TODAY}T05:00:00Z`,
    ...overrides,
  }
}

describe('completeness', () => {
  it('names exactly the onboarding-required fields that are missing', () => {
    expect(missingFieldLabels(['height_cm', 'current_weight'])).toEqual([
      'Height',
      'Current weight',
    ])
    expect(missingFieldLabels([])).toEqual([])
  })
})

describe('age', () => {
  it('is derived from the date of birth and today', () => {
    expect(ageOn('1992-09-30', TODAY)).toBe(33)
    expect(ageOn('1992-09-29', TODAY)).toBe(34)
  })
})

describe('steps', () => {
  it('uses the active (latest) entry of a day — never the sum', () => {
    const days = stepsByDay([
      entry({ id: 'a', steps: 4000, createdAt: `${TODAY}T05:00:00Z` }),
      entry({ id: 'b', steps: 8420, isActive: true, createdAt: `${TODAY}T12:00:00Z` }),
      entry({ id: 'c', date: '2026-09-27', steps: 7812, isActive: true }),
    ])
    expect(days.map((day) => [day.date, day.active, day.entries.length])).toEqual([
      [TODAY, 8420, 2],
      ['2026-09-27', 7812, 1],
    ])
    expect(days[0]?.entries.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('falls back to the most recent entry if none is marked active', () => {
    const [day] = stepsByDay([
      entry({ id: 'a', steps: 4000, createdAt: `${TODAY}T05:00:00Z` }),
      entry({ id: 'b', steps: 5000, createdAt: `${TODAY}T09:00:00Z` }),
    ])
    expect(day?.active).toBe(5000)
  })

  it('days without entries are simply absent (no zeros)', () => {
    expect(stepsByDay([])).toEqual([])
  })

  it('only today’s records are editable', () => {
    expect(isEditableDay(TODAY, TODAY)).toBe(true)
    expect(isEditableDay('2026-09-28', TODAY)).toBe(false)
  })
})

describe('recommendation review', () => {
  const rec = (status: 'IN_REVIEW' | 'LOCKED', start: string) => ({
    status,
    periodStart: start,
    reviewDeadline: new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10),
  })

  it('is in review on the generation day and the next day', () => {
    expect(reviewState(rec('IN_REVIEW', TODAY), TODAY)).toEqual({
      kind: 'review',
      until: '2026-09-30',
    })
    expect(reviewState(rec('IN_REVIEW', '2026-09-28'), TODAY)).toEqual({
      kind: 'review',
      until: TODAY,
    })
  })

  it('locks after the window even if never accepted, and once accepted', () => {
    expect(reviewState(rec('IN_REVIEW', '2026-09-27'), TODAY)).toEqual({
      kind: 'active',
      since: '2026-09-27',
    })
    expect(reviewState(rec('LOCKED', TODAY), TODAY).kind).toBe('active')
  })

  it('no recommendation is never invented', () => {
    expect(reviewState(null, TODAY)).toEqual({ kind: 'none' })
  })

  it('distinguishes final from recommended', () => {
    expect(isEdited(2000, 1900)).toBe(true)
    expect(isEdited(140, 140)).toBe(false)
  })
})

describe('errors', () => {
  it('never shows database internals', () => {
    expect(
      friendlyProfileError(
        { code: 'XX000', message: 'violates check constraint "weight_range"' },
        'Couldn’t save the weight. Please try again.',
      ),
    ).toBe('Couldn’t save the weight. Please try again.')
    expect(
      friendlyProfileError(
        { code: '42501', message: 'The review window has closed; this recommendation is locked' },
        'x',
      ),
    ).toBe('The review window has closed. This recommendation is locked.')
    expect(friendlyProfileError({ code: '42501', message: 'Record is locked' }, 'x')).toMatch(
      /locked/,
    )
    expect(
      friendlyProfileError(
        { code: '22023', message: 'Entries cannot be dated in the future' },
        'x',
      ),
    ).toMatch(/future/)
  })
})
