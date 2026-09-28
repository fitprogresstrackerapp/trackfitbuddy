/**
 * Progress against the real database: the known history in progress-fixtures
 * is read through the app's data functions as the signed-in user (RLS) and
 * run through the shared Progress logic. Expected numbers are derived by hand
 * from the fixture, not from the code under test.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  fetchBodyPeriod,
  fetchCurrentPlan,
  fetchNutritionPeriod,
  fetchStepsPeriod,
  fetchTrainingPeriod,
} from '@/features/progress/api/progress-data'
import {
  change,
  compositionSeries,
  cyclePeriod,
  datesIn,
  entryTotals,
  nutritionSeries,
  rangePeriod,
  stepsSummary,
  summarizeNutrition,
  targetsByDate,
  weeklyTraining,
  weightSeries,
  workoutAdherence,
} from '@/features/progress/lib/progress-logic'
import type { Period } from '@/features/progress/types'
import { addDays, calendarWeekOf } from '@/lib/dates/local-date'

import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, TODAY } from './home-fixtures.ts'
import {
  CYCLE_A,
  CYCLE_B,
  CYCLE_B_START,
  FIXTURE_WORKOUT_DATES,
  seedProgressHistory,
} from './progress-fixtures.ts'
import { uniqueTag } from './food-fixtures.ts'

describe('Progress', () => {
  const admin = adminClient()
  let owner: { userId: string; phone: string; pin: string }
  let empty: { userId: string; phone: string; pin: string }
  let ownerClient: BrowserClient
  let emptyClient: BrowserClient
  const days30 = rangePeriod('30D', TODAY)

  beforeAll(async () => {
    owner = await createUser('1234')
    empty = await createUser('4321')
    await seedProgressHistory(admin, owner.userId, uniqueTag())
    await completeProfile(admin, empty.userId)
    ownerClient = await signedInClient(owner.phone, owner.pin)
    emptyClient = await signedInClient(empty.phone, empty.pin)
  })

  async function nutrition(client: BrowserClient, userId: string, period: Period) {
    const data = await fetchNutritionPeriod(client, userId, period)
    const targets = targetsByDate(datesIn(period), data.snapshots, data.cycles)
    const points = nutritionSeries(period, data.days, targets)
    return { data, targets, points, summary: summarizeNutrition(points, targets, TODAY) }
  }

  describe('a user with no data', () => {
    it('has no values, no targets and no recommendation — nothing is zero', async () => {
      const plan = await fetchCurrentPlan(emptyClient, empty.userId, TODAY)
      expect(plan).toEqual({ cycle: null, cycleGoal: null, activeGoal: null })

      const { data, points, summary } = await nutrition(emptyClient, empty.userId, days30)
      expect(data.days).toEqual([])
      expect(points.every((point) => point.actual.calories === null)).toBe(true)
      expect(points.every((point) => point.target.calories === null)).toBe(true)
      expect(summary.trackedDays).toBe(0)
      expect(summary.nutrients.calories).toEqual({
        averageActual: null,
        averageTarget: null,
        adherence: { met: 0, eligible: 0, rate: null },
      })

      const training = await fetchTrainingPeriod(emptyClient, empty.userId, days30)
      expect(entryTotals(training.workouts, days30)).toBeNull()
      expect(entryTotals(training.activities, days30)).toBeNull()
      expect(await fetchStepsPeriod(emptyClient, empty.userId, days30)).toEqual([])
    })
  })

  describe('nutrition', () => {
    it('daily totals come from logged snapshots; deleted meals and unlogged days are absent', async () => {
      const { data } = await nutrition(ownerClient, owner.userId, days30)
      expect(data.days.map((day) => [day.date, day.calories, day.proteinG])).toEqual([
        [addDays(TODAY, -20), 2000, 200],
        [addDays(TODAY, -16), 1500, 150],
        [addDays(TODAY, -10), 1900, 190],
        [addDays(TODAY, -5), 1000, 100],
        [TODAY, 500, 50],
      ])
    })

    it('each date uses the target in force that day (historical target change)', async () => {
      const { points } = await nutrition(ownerClient, owner.userId, days30)
      const on = (offset: number) => points.find((point) => point.date === addDays(TODAY, offset))
      expect(on(-20)?.target.calories).toBe(CYCLE_A.calories)
      expect(on(-15)?.target.calories).toBe(CYCLE_A.calories)
      expect(on(-14)?.target.calories).toBe(CYCLE_B.calories)
      expect(on(-10)?.target.proteinG).toBe(CYCLE_B.protein)
      expect(on(-29)?.target.calories).toBe(CYCLE_A.calories)
    })

    it('adherence = days meeting target / eligible tracked (completed) days', async () => {
      const { summary } = await nutrition(ownerClient, owner.userId, days30)
      expect(summary.trackedDays).toBe(4) // today is not complete yet
      expect(summary.nutrients.calories.adherence).toEqual({ met: 2, eligible: 4, rate: 0.5 })
      expect(summary.nutrients.proteinG.adherence).toEqual({ met: 3, eligible: 4, rate: 0.75 })
      expect(summary.nutrients.calories.averageActual).toBe(1600)
      expect(summary.nutrients.calories.averageTarget).toBe(1950)
    })

    it('another user’s totals and targets are never returned', async () => {
      const { data, points } = await nutrition(emptyClient, owner.userId, days30)
      expect(data.days).toEqual([]) // daily_nutrition only aggregates the caller
      expect(data.snapshots).toEqual([])
      expect(data.cycles).toEqual([])
      expect(points.every((point) => point.target.calories === null)).toBe(true)
    })
  })

  describe('training and activities', () => {
    it('counts distinct workout days; deleted excluded; locked included; type ignored', async () => {
      const training = await fetchTrainingPeriod(ownerClient, owner.userId, days30)
      expect(entryTotals(training.workouts, days30)).toEqual({
        sessions: 4,
        days: 3,
        minutes: 155,
        calories: 930,
        averageMinutes: 39,
      })
    })

    it('weekly completion matches an independent Monday–Sunday count', async () => {
      const period = rangePeriod('3M', TODAY)
      const training = await fetchTrainingPeriod(ownerClient, owner.userId, period)
      const targets = targetsByDate(datesIn(training.fetched), training.snapshots, training.cycles)
      const weeks = weeklyTraining(period, training.workouts, targets, training.cycles, TODAY)

      for (const week of weeks) {
        const expectedDone = new Set(
          FIXTURE_WORKOUT_DATES.filter((date) => date >= week.start && date <= week.end),
        ).size
        expect(week.done).toBe(expectedDone)
      }
      // The week in which cycle B started mid-week is partial unless B began on a Monday.
      const bWeek = weeks.find((week) => week.start === calendarWeekOf(CYCLE_B_START).start)
      expect(bWeek?.status).toBe(CYCLE_B_START === bWeek?.start ? 'counted' : 'partial')
      // Weeks before any recommendation have no capacity and are never judged.
      expect(weeks[0]?.status).toBe('no-capacity')
      expect(weeks.at(-1)?.status).toBe('in-progress')
      const adherence = workoutAdherence(weeks)
      expect(adherence.expected).toBe(
        weeks
          .filter((week) => week.status === 'counted')
          .reduce((sum, week) => sum + (week.capacity ?? 0), 0),
      )
    })

    it('activities are separate, use stored calories (manual wins) and have no target', async () => {
      const training = await fetchTrainingPeriod(ownerClient, owner.userId, days30)
      expect(entryTotals(training.activities, days30)).toEqual({
        sessions: 2,
        days: 2,
        minutes: 130,
        calories: 650,
        averageMinutes: 65,
      })
      const other = await fetchTrainingPeriod(emptyClient, owner.userId, days30)
      expect(other.workouts).toEqual([])
      expect(other.activities).toEqual([])
    })

    it('steps average only days with an entry, using the latest entry of a day', async () => {
      const steps = await fetchStepsPeriod(ownerClient, owner.userId, days30)
      expect(steps).toEqual([
        { date: addDays(TODAY, -3), steps: 8000 },
        { date: addDays(TODAY, -2), steps: 10000 },
      ])
      expect(stepsSummary(steps)).toEqual({ average: 9000, days: 2 })
    })
  })

  describe('body', () => {
    it('weight: real measurements only, InBody wins on the same date, deleted excluded', async () => {
      const body = await fetchBodyPeriod(ownerClient, owner.userId, days30)
      const series = weightSeries(body.weights)
      expect(series).toEqual([
        { date: addDays(TODAY, -25), weightKg: 80, source: 'MANUAL' },
        { date: addDays(TODAY, -10), weightKg: 79, source: 'INBODY' },
        { date: addDays(TODAY, -2), weightKg: 78.6, source: 'MANUAL' },
      ])
      expect(
        change(series.map((point) => ({ date: point.date, value: point.weightKg })))?.delta,
      ).toBe(-1.4)
      // The manual entry on the InBody day is still in the history.
      expect(body.weights.filter((weight) => weight.date === addDays(TODAY, -10))).toHaveLength(2)
    })

    it('body fat (percentage points) and muscle mass come only from InBody', async () => {
      const body = await fetchBodyPeriod(ownerClient, owner.userId, rangePeriod('3M', TODAY))
      expect(change(compositionSeries(body.composition, 'bodyFatPercent'))?.delta).toBe(-0.9)
      expect(change(compositionSeries(body.composition, 'muscleMassKg'))?.delta).toBe(0.6)
      const recent = await fetchBodyPeriod(ownerClient, owner.userId, rangePeriod('7D', TODAY))
      expect(recent.composition).toEqual([])
      expect(change(compositionSeries(recent.composition, 'bodyFatPercent'))).toBeNull()
    })

    it('another user cannot read weight or InBody data', async () => {
      const body = await fetchBodyPeriod(emptyClient, owner.userId, rangePeriod('1Y', TODAY))
      expect(body.weights).toEqual([])
      expect(body.composition).toEqual([])
    })
  })

  describe('current cycle and goals', () => {
    it('is the recommendation cycle covering today, with its locked goal', async () => {
      const plan = await fetchCurrentPlan(ownerClient, owner.userId, TODAY)
      expect(plan.cycle).toMatchObject({
        periodStart: CYCLE_B_START,
        periodEnd: null,
        status: 'LOCKED',
        workout_days_per_week: CYCLE_B.capacity,
      })
      expect(plan.cycleGoal).toMatchObject({
        longTermGoal: 'FAT_LOSS',
        focuses: ['MUSCLE_BUILDING', 'ENDURANCE'],
      })
      expect(plan.activeGoal?.longTermGoal).toBe('FAT_LOSS')

      const other = await fetchCurrentPlan(emptyClient, owner.userId, TODAY)
      expect(other.cycle).toBeNull()
    })

    it('cycle metrics cover recommendation-to-today, not a calendar month', async () => {
      const plan = await fetchCurrentPlan(ownerClient, owner.userId, TODAY)
      if (!plan.cycle) throw new Error('cycle missing')
      const period = cyclePeriod(plan.cycle, TODAY)
      expect(period).toEqual({ start: CYCLE_B_START, end: TODAY })
      const { summary } = await nutrition(ownerClient, owner.userId, period)
      expect(summary.nutrients.calories.adherence).toEqual({ met: 1, eligible: 2, rate: 0.5 })
      expect(summary.nutrients.proteinG.adherence).toEqual({ met: 1, eligible: 2, rate: 0.5 })
    })
  })
})
