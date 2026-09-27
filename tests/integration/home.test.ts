/**
 * Home data access against the real database: aggregation rules (snapshots,
 * soft deletion, active step entry, Monday–Sunday weeks) and RLS isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { fetchHomeNutrition, fetchHomePlan, fetchHomeTraining } from '@/features/home/api/home-data'

import { adminClient, createUser, signedInClient } from './helpers.ts'
import { completeProfile, seedDay, seedPlan, TODAY, WEEK } from './home-fixtures.ts'

describe('Home data', () => {
  const admin = adminClient()
  let owner: { userId: string; phone: string; pin: string }
  let other: { userId: string; phone: string; pin: string }

  beforeAll(async () => {
    owner = await createUser('1234')
    other = await createUser('4321')
    await completeProfile(admin, owner.userId)
    await completeProfile(admin, other.userId)
    await seedPlan(admin, owner.userId, true)
    await seedDay(admin, owner.userId)
  })

  it('reads today’s targets from the snapshot, with tolerance, goal and sessions', async () => {
    const client = await signedInClient(owner.phone, owner.pin)
    const plan = await fetchHomePlan(client, owner.userId, TODAY)
    expect(plan.targets).toEqual({
      calories: 2000,
      proteinG: 140,
      carbsG: 230,
      fatG: 65,
      fiberG: 30,
      workoutsPerWeek: 4,
      tolerance: { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 },
      source: 'snapshot',
    })
    expect(plan.cycle?.status).toBe('LOCKED')
    expect(plan.cycle?.sessions).toEqual(['Upper body', 'Lower body'])
    expect(plan.goal).toEqual({
      longTermGoal: 'FAT_LOSS',
      description: null,
      focuses: ['MUSCLE_BUILDING', 'GENERAL_FITNESS'],
    })
  })

  it('sums only valid meal-item snapshots for today', async () => {
    const client = await signedInClient(owner.phone, owner.pin)
    const { totals } = await fetchHomeNutrition(client, owner.userId, TODAY)
    // 100 g + 50 g of a 200 kcal/100 g food, logged before the master changed to 999.
    // Excluded: deleted item, items of a deleted meal, yesterday's meal.
    expect(totals).toEqual({
      calories: 300,
      proteinG: 30,
      carbsG: 15,
      fatG: 7.5,
      fiberG: 3,
      mealCount: 1,
      itemCount: 2,
    })
  })

  it('uses the active (latest) step entry, valid workouts this week and valid activities', async () => {
    const client = await signedInClient(owner.phone, owner.pin)
    const training = await fetchHomeTraining(client, owner.userId, TODAY)
    expect(training.steps).toBe(7842)
    expect(training.workoutsToday.map((workout) => workout.type)).toEqual(['CHEST_TRICEPS'])
    expect(training.workoutDaysThisWeek).toBe(new Set([TODAY, WEEK.start]).size)
    expect(training.week).toEqual(WEEK)
    expect(training.activitiesToday.map((activity) => activity.type)).toEqual(['CRICKET'])
  })

  it('reports missing data as missing for a user with nothing logged', async () => {
    const client = await signedInClient(other.phone, other.pin)
    expect(await fetchHomePlan(client, other.userId, TODAY)).toEqual({
      targets: null,
      cycle: null,
      goal: null,
    })
    expect(await fetchHomeNutrition(client, other.userId, TODAY)).toEqual({ totals: null })
    const training = await fetchHomeTraining(client, other.userId, TODAY)
    expect(training.steps).toBeNull()
    expect(training.workoutDaysThisWeek).toBe(0)
  })

  it('falls back to the covering cycle’s final targets when today has no snapshot', async () => {
    const user = await createUser('2468')
    await completeProfile(admin, user.userId)
    await seedPlan(admin, user.userId, false)
    const client = await signedInClient(user.phone, user.pin)
    const plan = await fetchHomePlan(client, user.userId, TODAY)
    expect(plan.targets).toMatchObject({
      calories: 2100,
      proteinG: 150,
      source: 'cycle',
      tolerance: null,
    })
  })

  it('never returns another user’s Home data, even when their id is requested', async () => {
    const intruder = await signedInClient(other.phone, other.pin)
    expect(await fetchHomePlan(intruder, owner.userId, TODAY)).toEqual({
      targets: null,
      cycle: null,
      goal: null,
    })
    expect(await fetchHomeNutrition(intruder, owner.userId, TODAY)).toEqual({ totals: null })
    const training = await fetchHomeTraining(intruder, owner.userId, TODAY)
    expect(training).toMatchObject({
      steps: null,
      workoutsToday: [],
      workoutDaysThisWeek: 0,
      activitiesToday: [],
    })
  })
})
