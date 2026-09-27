import { describe, expect, it } from 'vitest'

import { calendarWeekOf } from '@/lib/dates/local-date'

import type { CalorieRates, TrainingPlan, TrainingRecord } from '../types'
import {
  capacityStatus,
  countWorkoutDays,
  estimateCalories,
  formatDuration,
  friendlyTrainingError,
  groupByDate,
  isEditable,
  isTransitionWeek,
  parseWorkoutPlan,
  trainingTotals,
  workoutGuidance,
} from './training'

const TODAY = '2026-09-24' // Thursday
const WEEK = { start: '2026-09-21', end: '2026-09-27' }

const RATES: CalorieRates = {
  workout: { default: 6, HIIT: 10 },
  activity: { default: 5, WALKING: 4 },
}

function record(overrides: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    id: 'r1',
    kind: 'workout',
    date: TODAY,
    type: 'UPPER_BODY',
    name: null,
    durationMinutes: 45,
    estimatedCalories: 270,
    manualCalories: null,
    finalCalories: 270,
    isLocked: false,
    createdAt: '2026-09-24T05:00:00Z',
    ...overrides,
  }
}

const PLAN: TrainingPlan = {
  capacity: 4,
  cycle: {
    periodStart: '2026-09-01',
    sessions: [
      { name: 'Upper Body', durationMinutes: 45, focus: 'Strength' },
      { name: 'Lower Body', durationMinutes: null, focus: null },
      { name: 'Full Body', durationMinutes: null, focus: null },
      { name: 'Athletic', durationMinutes: null, focus: null },
    ],
  },
}

describe('weeks', () => {
  it('are Monday–Sunday calendar weeks, never rolling 7 days', () => {
    expect(calendarWeekOf('2026-09-21')).toEqual(WEEK) // Monday
    expect(calendarWeekOf('2026-09-24')).toEqual(WEEK)
    expect(calendarWeekOf('2026-09-27')).toEqual(WEEK) // Sunday
    expect(calendarWeekOf('2026-09-28')).toEqual({ start: '2026-09-28', end: '2026-10-04' })
  })
})

describe('countWorkoutDays', () => {
  it('counts distinct workout days, whatever the workout types', () => {
    expect(countWorkoutDays(['2026-09-21', '2026-09-22', '2026-09-24', '2026-09-24'], TODAY)).toBe(
      3,
    )
  })
  it('ignores dates after today', () => {
    expect(countWorkoutDays(['2026-09-24', '2026-09-25'], TODAY)).toBe(1)
  })
  it('is 0 with no workouts', () => {
    expect(countWorkoutDays([], TODAY)).toBe(0)
  })
})

describe('capacityStatus', () => {
  it('any 4 workouts meet a capacity of 4', () => {
    expect(capacityStatus(4, 4, false)).toEqual({ kind: 'met', done: 4, capacity: 4 })
    expect(capacityStatus(5, 4, false).kind).toBe('met')
  })
  it('reports sessions remaining', () => {
    expect(capacityStatus(3, 4, false)).toEqual({
      kind: 'remaining',
      done: 3,
      capacity: 4,
      remaining: 1,
    })
  })
  it('a partial (transition) week is never judged as a full week', () => {
    expect(capacityStatus(1, 4, true)).toEqual({ kind: 'partial', done: 1, capacity: 4 })
  })
  it('no recommendation means no capacity, not a fabricated one', () => {
    expect(capacityStatus(2, null, false)).toEqual({ kind: 'no-capacity' })
  })
})

describe('isTransitionWeek', () => {
  it('only when the cycle starts after this week’s Monday', () => {
    expect(isTransitionWeek({ periodStart: '2026-09-23' }, WEEK)).toBe(true)
    expect(isTransitionWeek({ periodStart: '2026-09-21' }, WEEK)).toBe(false)
    expect(isTransitionWeek({ periodStart: '2026-09-01' }, WEEK)).toBe(false)
    expect(isTransitionWeek({ periodStart: '2026-09-28' }, WEEK)).toBe(false)
    expect(isTransitionWeek(null, WEEK)).toBe(false)
  })
})

describe('workoutGuidance', () => {
  it('suggests template sessions in order, by workouts done', () => {
    expect(workoutGuidance(PLAN, 2)).toMatchObject({
      kind: 'next',
      session: { name: 'Full Body' },
      index: 2,
      total: 4,
    })
  })
  it('stops suggesting once capacity is met', () => {
    expect(workoutGuidance(PLAN, 4)).toEqual({ kind: 'capacity-met' })
  })
  it('without a recommendation there is no guidance', () => {
    expect(workoutGuidance(null, 0)).toEqual({ kind: 'none' })
    expect(workoutGuidance({ capacity: null, cycle: null }, 0)).toEqual({ kind: 'none' })
    expect(
      workoutGuidance({ capacity: 3, cycle: { periodStart: '2026-09-01', sessions: [] } }, 0),
    ).toEqual({
      kind: 'none',
    })
  })
})

describe('parseWorkoutPlan', () => {
  it('reads names with optional duration and focus; ignores anything else', () => {
    expect(
      parseWorkoutPlan({
        days_per_week: 3,
        sessions: [
          'Pull',
          { name: 'Upper Body', duration_minutes: 45, focus: 'Strength' },
          { oops: 1 },
        ],
      }),
    ).toEqual([
      { name: 'Pull', durationMinutes: null, focus: null },
      { name: 'Upper Body', durationMinutes: 45, focus: 'Strength' },
    ])
    expect(parseWorkoutPlan(null)).toEqual([])
    expect(parseWorkoutPlan({ sessions: 'nope' })).toEqual([])
  })
})

describe('estimateCalories', () => {
  it('is duration × the type’s rate, else the kind’s default', () => {
    expect(estimateCalories(RATES, 'workout', 'UPPER_BODY', 45)).toBe(270)
    expect(estimateCalories(RATES, 'workout', 'HIIT', 30)).toBe(300)
    expect(estimateCalories(RATES, 'activity', 'WALKING', 40)).toBe(160)
    expect(estimateCalories(RATES, 'activity', 'CRICKET', 90)).toBe(450)
  })
  it('has no estimate without a valid duration', () => {
    expect(estimateCalories(RATES, 'workout', 'LEGS', 0)).toBeNull()
    expect(estimateCalories(RATES, 'workout', 'LEGS', Number.NaN)).toBeNull()
  })
})

describe('records', () => {
  it('only today’s unlocked records are editable', () => {
    expect(isEditable(record(), TODAY)).toBe(true)
    expect(isEditable(record({ isLocked: true }), TODAY)).toBe(false)
    expect(isEditable(record({ date: '2026-09-23' }), TODAY)).toBe(false)
  })

  it('totals use the stored final value (manual override wins); none logged is null', () => {
    expect(
      trainingTotals([
        record(),
        record({ id: 'r2', durationMinutes: 30, manualCalories: 400, finalCalories: 400 }),
      ]),
    ).toEqual({ sessions: 2, minutes: 75, calories: 670 })
    expect(trainingTotals([])).toBeNull()
  })

  it('groups by day, newest day first', () => {
    const groups = groupByDate([
      record({ id: 'a', date: '2026-09-22' }),
      record({ id: 'b', date: '2026-09-24' }),
      record({ id: 'c', date: '2026-09-22' }),
    ])
    expect(groups.map(([date, entries]) => [date, entries.map((entry) => entry.id)])).toEqual([
      ['2026-09-24', ['b']],
      ['2026-09-22', ['a', 'c']],
    ])
  })

  it('formats durations compactly', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(240)).toBe('4h')
  })
})

describe('friendlyTrainingError', () => {
  it('never exposes database internals', () => {
    const message = friendlyTrainingError(
      { code: 'XX000', message: 'new row violates check constraint "workouts_duration_range"' },
      'Couldn’t save this workout. Please try again.',
    )
    expect(message).toBe('Couldn’t save this workout. Please try again.')
    expect(friendlyTrainingError({ code: '42501', message: 'Record is locked' }, 'x')).toMatch(
      /locked/i,
    )
    expect(
      friendlyTrainingError(
        { code: '22023', message: 'Training cannot be logged for a future date' },
        'x',
      ),
    ).toMatch(/future date/)
  })
})
