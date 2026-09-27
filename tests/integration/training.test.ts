/**
 * Workouts and activities against the real database, through the same data
 * functions the app uses, signed in as normal users (RLS applies): logging,
 * stored estimates and overrides, editing, soft deletion, locking, late
 * entry, weekly counting, Home, and cross-user isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { fetchHomeTraining } from '@/features/home/api/home-data'
import {
  deleteTraining,
  fetchCalorieRates,
  fetchTrainingPlan,
  fetchTrainingWeek,
  logTraining,
  updateTraining,
} from '@/features/training/api/training-data'
import { countWorkoutDays, trainingTotals } from '@/features/training/lib/training'
import type { TrainingInput } from '@/features/training/schemas'
import { addDays, calendarWeekOf } from '@/lib/dates/local-date'

import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must, seedPlan, TODAY, WEEK } from './home-fixtures.ts'
import { seedLockedActivity, seedLockedWorkout } from './training-fixtures.ts'

function input(overrides: Partial<TrainingInput> = {}): TrainingInput {
  return {
    type: 'UPPER_BODY',
    name: null,
    durationMinutes: 45,
    manualCalories: null,
    date: TODAY,
    ...overrides,
  }
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('Workouts and activities', () => {
  const admin = adminClient()
  let owner: { userId: string; phone: string; pin: string }
  let other: { userId: string; phone: string; pin: string }
  let ownerClient: BrowserClient
  let otherClient: BrowserClient
  let lockedWorkoutId: string
  let lockedActivityId: string
  const past = addDays(TODAY, -3)

  beforeAll(async () => {
    owner = await createUser('1234')
    other = await createUser('4321')
    await completeProfile(admin, owner.userId)
    await completeProfile(admin, other.userId)
    await seedPlan(admin, owner.userId, true)
    lockedWorkoutId = await seedLockedWorkout(admin, owner.userId, past, 'LEGS', 40)
    lockedActivityId = await seedLockedActivity(admin, owner.userId, past, 'WALKING', 30)
    ownerClient = await signedInClient(owner.phone, owner.pin)
    otherClient = await signedInClient(other.phone, other.pin)
  })

  describe('logging today', () => {
    let workoutId: string

    it('creates a workout; the database stores the estimate at log time', async () => {
      workoutId = await logTraining(ownerClient, 'workout', input({ name: 'Push Strength' }))
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(week.workouts.find((record) => record.id === workoutId)).toMatchObject({
        type: 'UPPER_BODY',
        name: 'Push Strength',
        durationMinutes: 45,
        estimatedCalories: 270,
        manualCalories: null,
        finalCalories: 270,
        isLocked: false,
      })
    })

    it('the preview rates are the same ones the database uses', async () => {
      const rates = await fetchCalorieRates(ownerClient)
      expect(rates.workout.default).toBe(6)
      expect(rates.activity.CRICKET).toBe(5)
    })

    it('a manual value overrides the estimate but the estimate is kept', async () => {
      const id = await logTraining(
        ownerClient,
        'workout',
        input({ type: 'HIIT', durationMinutes: 30, manualCalories: 400 }),
      )
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(week.workouts.find((record) => record.id === id)).toMatchObject({
        estimatedCalories: 300,
        manualCalories: 400,
        finalCalories: 400,
      })
    })

    it('edits an allowed record; changing the duration recomputes the estimate', async () => {
      await updateTraining(ownerClient, 'workout', workoutId, {
        type: 'UPPER_BODY',
        name: 'Push Strength',
        durationMinutes: 60,
        manualCalories: 350,
      })
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(week.workouts.find((record) => record.id === workoutId)).toMatchObject({
        durationMinutes: 60,
        estimatedCalories: 360,
        manualCalories: 350,
        finalCalories: 350,
      })
    })

    it('creates and reads activities separately from workouts', async () => {
      const id = await logTraining(
        ownerClient,
        'activity',
        input({ type: 'CRICKET', durationMinutes: 240 }),
      )
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(week.activities.find((record) => record.id === id)).toMatchObject({
        kind: 'activity',
        durationMinutes: 240,
        estimatedCalories: 1200,
      })
      expect(week.workouts.map((record) => record.id)).not.toContain(id)
    })

    it('rejects invalid values and future dates', async () => {
      await expectError(logTraining(ownerClient, 'workout', input({ durationMinutes: 0 })), '23514')
      await expectError(logTraining(ownerClient, 'workout', input({ manualCalories: -1 })), '23514')
      await expectError(logTraining(ownerClient, 'workout', input({ type: 'CUSTOM' })), '23514')
      await expectError(
        logTraining(ownerClient, 'activity', input({ type: 'UPPER_BODY' })),
        '23514',
      )
      await expectError(
        logTraining(ownerClient, 'workout', input({ date: addDays(TODAY, 1) })),
        '22023',
      )
    })

    it('deletes an allowed record softly; it is excluded everywhere', async () => {
      const id = await logTraining(
        ownerClient,
        'workout',
        input({ type: 'CARDIO', durationMinutes: 20 }),
      )
      await deleteTraining(ownerClient, 'workout', id)
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(week.workouts.map((record) => record.id)).not.toContain(id)
      const home = await fetchHomeTraining(ownerClient, owner.userId, TODAY)
      expect(home.workoutsToday.map((workout) => workout.id)).not.toContain(id)
      const row = await must(admin.from('workouts').select('is_deleted').eq('id', id).single())
      expect(row.is_deleted).toBe(true)
    })
  })

  describe('locking and late entry', () => {
    it('locked records stay readable but cannot be edited or deleted', async () => {
      const week = await fetchTrainingWeek(ownerClient, owner.userId, calendarWeekOf(past), TODAY)
      expect(week.workouts.find((record) => record.id === lockedWorkoutId)?.isLocked).toBe(true)
      await expectError(
        updateTraining(ownerClient, 'workout', lockedWorkoutId, {
          type: 'LEGS',
          name: null,
          durationMinutes: 10,
          manualCalories: null,
        }),
        '42501',
      )
      await expectError(deleteTraining(ownerClient, 'workout', lockedWorkoutId), '42501')
      await expectError(deleteTraining(ownerClient, 'activity', lockedActivityId), '42501')
      const { error } = await ownerClient
        .from('workouts')
        .update({ is_locked: false })
        .eq('id', lockedWorkoutId)
      expect(error?.code).toBe('42501')
    })

    it('direct past-dated inserts are still rejected', async () => {
      const { error } = await ownerClient.from('workouts').insert({
        user_id: owner.userId,
        workout_date: addDays(TODAY, -2),
        workout_type: 'LEGS',
        duration_minutes: 30,
        estimated_calories: 0,
      })
      expect(error?.code).toBe('42501')
    })

    it('a missing past workout goes through the late-entry function and is locked', async () => {
      const day = addDays(TODAY, -2)
      const id = await logTraining(
        ownerClient,
        'workout',
        input({ type: 'BACK_BICEPS', date: day }),
      )
      const week = await fetchTrainingWeek(ownerClient, owner.userId, calendarWeekOf(day), TODAY)
      expect(week.workouts.find((record) => record.id === id)).toMatchObject({
        date: day,
        estimatedCalories: 270,
      })
      await expectError(deleteTraining(ownerClient, 'workout', id), '42501')
      await expectError(
        logTraining(ownerClient, 'workout', input({ date: addDays(TODAY, -91) })),
        '22023',
      )
    })

    it('admin correction of a locked record still works (service role)', async () => {
      await must(
        admin
          .from('workouts')
          .update({ manual_calories: 500 })
          .eq('id', lockedWorkoutId)
          .select('id'),
      )
      const row = await must(
        admin.from('workouts').select('final_calories').eq('id', lockedWorkoutId).single(),
      )
      expect(row.final_calories).toBe(500)
    })
  })

  describe('weekly summary and Home', () => {
    it('counts distinct workout days in the Monday–Sunday week; activities never count', async () => {
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      const expected = new Set(week.workouts.map((record) => record.date)).size
      expect(
        countWorkoutDays(
          week.workouts.map((record) => record.date),
          TODAY,
        ),
      ).toBe(expected)
      // today (several workouts) + today-2 (late) + today-3 (locked) when inside this week
      const days = [TODAY, addDays(TODAY, -2), past].filter((date) => date >= WEEK.start)
      expect(expected).toBe(days.length)
      expect(trainingTotals(week.activities)?.sessions).toBeGreaterThan(0)
    })

    it('capacity comes from the recommendation in force', async () => {
      const plan = await fetchTrainingPlan(ownerClient, owner.userId, TODAY)
      expect(plan.capacity).toBe(4)
      expect(plan.cycle?.sessions.map((session) => session.name)).toEqual([
        'Upper body',
        'Lower body',
      ])
      const none = await fetchTrainingPlan(otherClient, other.userId, TODAY)
      expect(none).toEqual({ capacity: null, cycle: null })
    })

    it('Home receives the same workouts, days and activities', async () => {
      const week = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      const home = await fetchHomeTraining(ownerClient, owner.userId, TODAY)
      expect(home.workoutDaysThisWeek).toBe(
        countWorkoutDays(
          week.workouts.map((record) => record.date),
          TODAY,
        ),
      )
      expect(home.workoutsToday.map((workout) => workout.id).sort()).toEqual(
        week.workouts
          .filter((record) => record.date === TODAY)
          .map((record) => record.id)
          .sort(),
      )
      expect(home.activitiesToday.map((activity) => activity.id).sort()).toEqual(
        week.activities
          .filter((record) => record.date === TODAY)
          .map((record) => record.id)
          .sort(),
      )
    })
  })

  describe('isolation', () => {
    it('another user cannot read, change or delete the owner’s records', async () => {
      const mine = await fetchTrainingWeek(otherClient, owner.userId, WEEK, TODAY)
      expect(mine.workouts).toEqual([])
      expect(mine.activities).toEqual([])

      const ownerWeek = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      const target = ownerWeek.workouts.find((record) => record.date === TODAY)
      if (!target) throw new Error('owner workout missing')
      const { data } = await otherClient
        .from('workouts')
        .update({ manual_calories: 1 })
        .eq('id', target.id)
        .select('id')
      expect(data).toEqual([])
      const deleted = await otherClient
        .from('activities')
        .update({ is_deleted: true })
        .eq('user_id', owner.userId)
        .select('id')
      expect(deleted.data).toEqual([])

      const { error } = await otherClient.from('workouts').insert({
        user_id: owner.userId,
        workout_date: TODAY,
        workout_type: 'LEGS',
        duration_minutes: 30,
        estimated_calories: 0,
      })
      expect(error?.code).toBe('42501')

      const after = await fetchTrainingWeek(ownerClient, owner.userId, WEEK, TODAY)
      expect(after.workouts.find((record) => record.id === target.id)?.finalCalories).toBe(
        target.finalCalories,
      )
    })
  })
})
