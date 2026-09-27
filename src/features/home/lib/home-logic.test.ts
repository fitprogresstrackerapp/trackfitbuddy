import { describe, expect, it } from 'vitest'

import type { DailyTargets, HomeTraining, PlanCycle } from '../types'
import {
  calorieBalance,
  countWorkoutDays,
  evaluateCalories,
  evaluateNutrient,
  isTransitionWeek,
  nextAction,
  nextSession,
  planState,
  sumNutrition,
} from './home-logic'

const TOLERANCE = { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 }

const item = (calories: number, protein = 0) => ({
  snapshot_calories: calories,
  snapshot_protein_g: protein,
  snapshot_carbs_g: 1,
  snapshot_fat_g: 1,
  snapshot_fiber_g: 1,
})

const targets: DailyTargets = {
  calories: 2000,
  proteinG: 140,
  carbsG: 250,
  fatG: 65,
  fiberG: 30,
  workoutsPerWeek: 4,
  tolerance: TOLERANCE,
  source: 'snapshot',
}

const training = (overrides: Partial<HomeTraining> = {}): HomeTraining => ({
  steps: 5000,
  workoutsToday: [],
  workoutDaysThisWeek: 1,
  week: { start: '2026-09-21', end: '2026-09-27' },
  activitiesToday: [],
  ...overrides,
})

const cycle = (overrides: Partial<PlanCycle> = {}): PlanCycle => ({
  id: 'c1',
  status: 'LOCKED',
  periodStart: '2026-09-04',
  reviewDeadline: '2026-09-05',
  workoutDaysPerWeek: 4,
  sessions: [],
  ...overrides,
})

describe('sumNutrition', () => {
  it('returns null (not zeros) when nothing is logged', () => {
    expect(sumNutrition([])).toBeNull()
    expect(sumNutrition([{ meal_items: [] }])).toBeNull()
  })

  it('sums meal-item snapshots across meals', () => {
    const totals = sumNutrition([
      { meal_items: [item(450.5, 30), item(200, 12.25)] },
      { meal_items: [item(799.5, 62.75)] },
      { meal_items: [] },
    ])
    expect(totals).toEqual({
      calories: 1450,
      proteinG: 105,
      carbsG: 3,
      fatG: 3,
      fiberG: 3,
      mealCount: 2,
      itemCount: 3,
    })
  })
})

describe('nutrient tolerance (spec §27)', () => {
  it('meets at target × 85% and not below it', () => {
    expect(evaluateNutrient(119, 140, TOLERANCE)).toBe('met')
    expect(evaluateNutrient(118, 140, TOLERANCE)).toBe('below')
  })

  it('never treats missing data as zero', () => {
    expect(evaluateNutrient(null, 140, TOLERANCE)).toBe('no-data')
    expect(evaluateCalories(null, 2000, TOLERANCE)).toBe('no-data')
  })

  it('reports no status when the tolerance in force is unknown', () => {
    expect(evaluateNutrient(120, 140, null)).toBeNull()
    expect(evaluateCalories(1900, 2000, null)).toBeNull()
  })

  it('treats calories as a range, not "more is better"', () => {
    expect(evaluateCalories(1699, 2000, TOLERANCE)).toBe('below')
    expect(evaluateCalories(1700, 2000, TOLERANCE)).toBe('within')
    expect(evaluateCalories(2200, 2000, TOLERANCE)).toBe('within')
    expect(evaluateCalories(2201, 2000, TOLERANCE)).toBe('above')
  })
})

describe('calorieBalance', () => {
  it('is food target minus food intake — expenditure is never subtracted', () => {
    expect(calorieBalance(1450, 2000)).toEqual({ remaining: 550 })
    expect(calorieBalance(2150, 2000)).toEqual({ remaining: -150 })
    expect(calorieBalance(null, 2000)).toBeNull()
  })
})

describe('weekly workouts', () => {
  it('counts distinct days up to today', () => {
    expect(
      countWorkoutDays(['2026-09-21', '2026-09-21', '2026-09-23', '2026-09-26'], '2026-09-25'),
    ).toBe(2)
  })

  it('flags a transition week when the cycle starts mid-week', () => {
    const week = { start: '2026-09-21', end: '2026-09-27' }
    expect(isTransitionWeek(cycle({ periodStart: '2026-09-24' }), week)).toBe(true)
    expect(isTransitionWeek(cycle({ periodStart: '2026-09-21' }), week)).toBe(false)
    expect(isTransitionWeek(cycle({ periodStart: '2026-09-04' }), week)).toBe(false)
    expect(isTransitionWeek(null, week)).toBe(false)
  })

  it('picks the next template session in order, on any day', () => {
    const plan = cycle({ sessions: ['Upper body', 'Lower body', 'Pull', 'Full body'] })
    expect(nextSession(plan, 0)).toBe('Upper body')
    expect(nextSession(plan, 2)).toBe('Pull')
    expect(nextSession(plan, 4)).toBeNull()
    expect(nextSession(cycle(), 0)).toBeNull()
  })
})

describe('planState', () => {
  it('distinguishes none, review window and active', () => {
    expect(planState(null, '2026-09-27')).toEqual({ kind: 'none' })
    expect(
      planState(
        cycle({ status: 'IN_REVIEW', periodStart: '2026-09-26', reviewDeadline: '2026-09-27' }),
        '2026-09-27',
      ),
    ).toEqual({ kind: 'review', until: '2026-09-27' })
    // Review window over but not yet locked by the job: treated as active.
    expect(planState(cycle({ status: 'IN_REVIEW' }), '2026-09-27')).toEqual({
      kind: 'active',
      since: '2026-09-04',
    })
  })
})

describe('nextAction', () => {
  it('asks for food first when nothing is logged', () => {
    expect(nextAction({ nutrition: { totals: null }, training: training(), targets }).action).toBe(
      'food',
    )
  })

  it('points to protein when it is below tolerance', () => {
    const next = nextAction({
      nutrition: {
        totals: {
          calories: 1500,
          proteinG: 90,
          carbsG: 0,
          fatG: 0,
          fiberG: 0,
          mealCount: 2,
          itemCount: 3,
        },
      },
      training: training(),
      targets,
    })
    expect(next.message).toMatch(/protein/i)
    expect(next.detail).toBe('50 g to go.')
  })

  it('suggests a workout only against the weekly capacity, never a daily requirement', () => {
    const fed = {
      totals: {
        calories: 1800,
        proteinG: 130,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        mealCount: 3,
        itemCount: 5,
      },
    }
    expect(
      nextAction({ nutrition: fed, training: training({ workoutDaysThisWeek: 2 }), targets })
        .action,
    ).toBe('workout')
    expect(
      nextAction({ nutrition: fed, training: training({ workoutDaysThisWeek: 4 }), targets })
        .action,
    ).not.toBe('workout')
    expect(
      nextAction({ nutrition: fed, training: training({ workoutDaysThisWeek: 2 }), targets: null })
        .action,
    ).not.toBe('workout')
  })

  it('falls back to "nothing urgent"', () => {
    const fed = {
      totals: {
        calories: 1800,
        proteinG: 130,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        mealCount: 3,
        itemCount: 5,
      },
    }
    expect(
      nextAction({ nutrition: fed, training: training({ workoutDaysThisWeek: 4 }), targets }),
    ).toEqual({
      message: 'Nothing urgent.',
      detail: 'Keep logging today’s meals and activity.',
      action: null,
    })
  })

  it('does not claim “nothing urgent” when a section failed to load', () => {
    expect(nextAction({ nutrition: undefined, training: undefined, targets: undefined })).toEqual({
      message: 'Some of today’s data couldn’t be loaded.',
      detail: 'Retry the section above to see what’s next.',
      action: null,
    })
  })
})
