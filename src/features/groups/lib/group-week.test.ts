import { describe, expect, it } from 'vitest'

import type { MemberWeekDay } from '../api/groups-data'
import {
  formatStepsPerDay,
  formatWorkouts,
  groupWeeks,
  memberWeeks,
  neutralOrder,
  participation,
  weekChange,
} from './group-week'

// Wednesday 30 Sep 2026: this week is Mon 28 Sep – Sun 4 Oct.
const TODAY = '2026-09-30'
const WEEK = { start: '2026-09-28', end: '2026-10-04' }
const LAST = { start: '2026-09-21', end: '2026-09-27' }
const TOLERANCE = { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 }

function day(date: string, overrides: Partial<MemberWeekDay> = {}): MemberWeekDay {
  return {
    date,
    userId: 'a',
    name: 'Asha',
    role: 'MEMBER',
    calories: null,
    caloriesTarget: 2000,
    proteinG: null,
    proteinTargetG: 140,
    steps: null,
    workoutLogged: false,
    tolerance: TOLERANCE,
    workoutsPerWeek: 4,
    cycleStart: '2026-09-01',
    ...overrides,
  }
}

const one = (days: MemberWeekDay[], week = WEEK, today = TODAY) => {
  const [member] = memberWeeks(days, week, today)
  if (!member) throw new Error('no member')
  return member
}

describe('weeks', () => {
  it('are Monday–Sunday in the user calendar, this week and the one before', () => {
    expect(groupWeeks(TODAY)).toEqual({ current: WEEK, previous: LAST })
    // Sunday still belongs to the week that started on Monday.
    expect(groupWeeks('2026-10-04').current).toEqual(WEEK)
    // Monday starts a new week.
    expect(groupWeeks('2026-10-05').current.start).toBe('2026-10-05')
  })
})

describe('nutrition and protein (the Progress rules)', () => {
  it('count completed days with logged food and a target; today never counts as a miss', () => {
    const member = one([
      day('2026-09-28', { calories: 1950, proteinG: 150 }), // in range, protein met
      day('2026-09-29', { calories: 2600, proteinG: 100 }), // above range, protein below
      day('2026-09-30', { calories: 400, proteinG: 10 }), // today: not complete yet
    ])
    expect(member.nutrition).toEqual({ met: 1, eligible: 2, rate: 0.5 })
    expect(member.protein).toEqual({ met: 1, eligible: 2, rate: 0.5 })
  })

  it('keep missing data missing: no food, no target or no tolerance is not a failure', () => {
    const member = one([
      day('2026-09-28'), // nothing logged
      day('2026-09-29', { calories: 1900, proteinG: 150, tolerance: null }), // no snapshot
    ])
    expect(member.nutrition.rate).toBeNull()
    expect(member.protein.rate).toBeNull()
    expect(formatStepsPerDay(member.steps)).toBe('—')
  })

  it('never exceed 100%', () => {
    const member = one(
      [
        day('2026-09-21', { calories: 2000, proteinG: 300 }),
        day('2026-09-22', { calories: 2000, proteinG: 300 }),
      ],
      LAST,
    )
    expect(member.protein.rate).toBe(1)
  })
})

describe('workouts (the Workout rules)', () => {
  it('count distinct workout days against the capacity in force; activities are not workouts', () => {
    const member = one([
      day('2026-09-28', { workoutLogged: true }),
      day('2026-09-29', { workoutLogged: true }),
      day('2026-09-30'),
    ])
    expect(member.workouts).toEqual({ done: 2, capacity: 4, status: 'in-progress' })
    expect(formatWorkouts(member.workouts)).toBe('2 / 4')
  })

  it('a completed week is counted; a week where a new plan started is partial', () => {
    expect(
      one([day('2026-09-21', { workoutLogged: true }), day('2026-09-27')], LAST).workouts,
    ).toMatchObject({ done: 1, status: 'counted' })
    expect(
      one(
        [
          day('2026-09-24', { workoutLogged: true, cycleStart: '2026-09-24' }),
          day('2026-09-27', { cycleStart: '2026-09-24' }),
        ],
        LAST,
      ).workouts.status,
    ).toBe('partial')
  })

  it('show only the count when no capacity is in force', () => {
    const member = one([day('2026-09-28', { workoutLogged: true, workoutsPerWeek: null })])
    expect(member.workouts.capacity).toBeNull()
    expect(formatWorkouts(member.workouts)).toBe('1')
    expect(formatWorkouts({ done: 0, capacity: null, status: 'no-capacity' })).toBe('—')
    expect(formatWorkouts({ done: 0, capacity: 3, status: 'counted' })).toBe('0 / 3')
  })
})

describe('steps', () => {
  it('average the days with an entry; no step goal; missing days are not zero', () => {
    const member = one([
      day('2026-09-28', { steps: 8000 }),
      day('2026-09-29'),
      day('2026-09-30', { steps: 6800 }),
    ])
    expect(member.steps).toEqual({ average: 7400, days: 2 })
    expect(formatStepsPerDay(member.steps)).toBe('7.4k/day')
  })
})

describe('membership', () => {
  it('a member who joined on Wednesday counts from Wednesday', () => {
    const member = one([day('2026-09-30', { workoutLogged: true, steps: 5000 })])
    expect(member.firstDay).toBe('2026-09-30')
    expect(member.workouts.done).toBe(1)
    expect(member.nutrition.eligible).toBe(0)
  })
})

describe('neutral order and participation', () => {
  const weeks = memberWeeks(
    [
      day('2026-09-28', { userId: 'z', name: 'Zara', calories: 2000, proteinG: 150, steps: 20000 }),
      day('2026-09-28', { userId: 'b', name: 'ben' }),
      day('2026-09-28', { userId: 'me', name: 'Asha', workoutLogged: true }),
      day('2026-09-28', { userId: 'c', name: 'Chen', steps: 3000 }),
    ],
    WEEK,
    TODAY,
  )

  it('lists you first, then by name, never by any result', () => {
    expect(neutralOrder(weeks, 'me').map((member) => member.name)).toEqual([
      'Asha',
      'ben',
      'Chen',
      'Zara',
    ])
  })

  it('counts members who logged something, without saying who did better', () => {
    expect(participation(weeks)).toEqual({
      members: 4,
      active: 3,
      nutrition: 1,
      workout: 1,
      steps: 2,
    })
  })

  it('has no ranking, score or position anywhere in the result', () => {
    const keys = weeks.flatMap((member) => Object.keys(member))
    expect(keys.join(',')).not.toMatch(/rank|score|position|place|points/i)
  })
})

describe('your week against last week', () => {
  const current = one([
    day('2026-09-28', { calories: 2000, proteinG: 150, workoutLogged: true, steps: 9000 }),
    day('2026-09-29', { calories: 2000, proteinG: 100, workoutLogged: true }),
    day('2026-09-30'),
  ])
  const previous = one(
    [
      day('2026-09-21', { calories: 2600, proteinG: 150, workoutLogged: true, steps: 8000 }),
      day('2026-09-22', { calories: 2000, proteinG: 150 }),
      day('2026-09-27'),
    ],
    LAST,
  )

  it('compares only where both weeks have a value', () => {
    expect(weekChange(current, previous)).toEqual({
      nutrition: 50, // 100% vs 50%
      protein: -50, // 50% vs 100%
      workouts: 1,
      steps: 1000,
    })
  })

  it('invents nothing when last week has no data', () => {
    expect(weekChange(current, null)).toEqual({
      nutrition: null,
      protein: null,
      workouts: null,
      steps: null,
    })
    const empty = one([day('2026-09-21')], LAST)
    expect(weekChange(current, empty)).toMatchObject({ nutrition: null, steps: null })
  })
})
