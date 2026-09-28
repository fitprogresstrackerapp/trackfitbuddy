import { describe, expect, it } from 'vitest'

import { todayInTimeZone } from '@/lib/dates/local-date'

import type { CycleInfo, SnapshotInfo, TrainingEntry, WeightMeasurement } from '../types'
import { formatPercent, formatSigned, formatWeekLabel } from './progress-format'
import {
  change,
  compositionSeries,
  cycleOn,
  cyclePeriod,
  datesIn,
  entryTotals,
  goalProgress,
  hasBodyData,
  isRangeKey,
  nutritionSeries,
  rangePeriod,
  stepsSummary,
  summarizeNutrition,
  targetsByDate,
  weeklyMinutes,
  weeklyTraining,
  weeksOverlapping,
  weightSeries,
  workoutAdherence,
} from './progress-logic'

const TODAY = '2026-09-28' // Monday

function cycle(overrides: Partial<CycleInfo> = {}): CycleInfo {
  return {
    id: 'c1',
    status: 'LOCKED',
    periodStart: '2026-08-04',
    periodEnd: null,
    reviewDeadline: '2026-08-05',
    goalId: null,
    workout_days_per_week: 4,
    final_calories: 2000,
    final_protein_g: 140,
    final_carbs_g: 230,
    final_fat_g: 65,
    final_fiber_g: 30,
    ...overrides,
  }
}

function snapshot(date: string, overrides: Partial<SnapshotInfo> = {}): SnapshotInfo {
  return {
    target_date: date,
    calories: 2000,
    protein_g: 140,
    carbs_g: 230,
    fat_g: 65,
    fiber_g: 30,
    workouts_per_week: 4,
    nutrition_tolerance: 0.85,
    calorie_lower_tolerance: 0.85,
    calorie_upper_tolerance: 1.1,
    ...overrides,
  }
}

describe('ranges', () => {
  it('7D and 30D include today and the previous 6 / 29 days', () => {
    expect(rangePeriod('7D', TODAY)).toEqual({ start: '2026-09-22', end: TODAY })
    expect(rangePeriod('30D', TODAY)).toEqual({ start: '2026-08-30', end: TODAY })
    expect(datesIn(rangePeriod('7D', TODAY))).toHaveLength(7)
    expect(datesIn(rangePeriod('30D', TODAY))).toHaveLength(30)
  })
  it('3M/6M/1Y are calendar months ending today', () => {
    expect(rangePeriod('3M', TODAY)).toEqual({ start: '2026-06-29', end: TODAY })
    expect(rangePeriod('6M', TODAY)).toEqual({ start: '2026-03-29', end: TODAY })
    expect(rangePeriod('1Y', TODAY)).toEqual({ start: '2025-09-29', end: TODAY })
  })
  it('clamps month ends and crosses leap years correctly', () => {
    expect(rangePeriod('3M', '2026-05-31')).toEqual({ start: '2026-03-01', end: '2026-05-31' })
    expect(rangePeriod('1Y', '2028-02-29')).toEqual({ start: '2027-03-01', end: '2028-02-29' })
  })
  it('the range ends on the user’s local day, not the UTC day', () => {
    // 20:00 UTC on Sep 27 is already Sep 28 in India.
    const today = todayInTimeZone('Asia/Kolkata', new Date('2026-09-27T20:00:00Z'))
    expect(today).toBe('2026-09-28')
    expect(rangePeriod('7D', today).end).toBe('2026-09-28')
  })
  it('validates the range parameter', () => {
    expect(isRangeKey('3M')).toBe(true)
    expect(isRangeKey('2W')).toBe(false)
    expect(isRangeKey(null)).toBe(false)
  })
})

describe('historical targets', () => {
  const cycleA = cycle({ id: 'a', periodStart: '2026-08-04', periodEnd: '2026-09-15' })
  const cycleB = cycle({
    id: 'b',
    periodStart: '2026-09-16',
    final_calories: 1900,
    workout_days_per_week: 3,
  })

  it('uses each date’s own snapshot, so a target change shows on its date', () => {
    const targets = targetsByDate(
      ['2026-09-15', '2026-09-16'],
      [snapshot('2026-09-15'), snapshot('2026-09-16', { calories: 1900 })],
      [cycleA, cycleB],
    )
    expect(targets.get('2026-09-15')?.calories).toBe(2000)
    expect(targets.get('2026-09-16')?.calories).toBe(1900)
    expect(targets.get('2026-09-16')?.tolerance?.nutrient).toBe(0.85)
  })
  it('falls back to the covering cycle (without tolerance), else none', () => {
    const targets = targetsByDate(['2026-09-20', '2026-07-01'], [], [cycleA, cycleB])
    expect(targets.get('2026-09-20')).toMatchObject({
      calories: 1900,
      tolerance: null,
      source: 'cycle',
    })
    expect(targets.get('2026-07-01')).toBeNull()
  })
  it('finds the cycle covering a date', () => {
    expect(cycleOn([cycleA, cycleB], '2026-09-15')?.id).toBe('a')
    expect(cycleOn([cycleA, cycleB], '2026-09-16')?.id).toBe('b')
    expect(cycleOn([cycleA], '2026-09-20')).toBeNull()
  })
})

describe('nutrition', () => {
  const period = { start: '2026-09-24', end: TODAY }
  const days = [
    {
      date: '2026-09-24',
      calories: 2000,
      proteinG: 120,
      carbsG: 200,
      fatG: 60,
      fiberG: 25,
      itemCount: 3,
    },
    {
      date: '2026-09-25',
      calories: 2300,
      proteinG: 118,
      carbsG: 250,
      fatG: 80,
      fiberG: 20,
      itemCount: 4,
    },
    // 2026-09-26 and 27: nothing logged
    { date: TODAY, calories: 400, proteinG: 30, carbsG: 40, fatG: 10, fiberG: 5, itemCount: 1 },
  ]
  const snapshots = datesIn(period).map((date) => snapshot(date))
  const targets = targetsByDate(datesIn(period), snapshots, [])
  const points = nutritionSeries(period, days, targets)

  it('missing days stay missing (null), never zero', () => {
    expect(points.find((point) => point.date === '2026-09-26')?.actual.calories).toBeNull()
    expect(points.find((point) => point.date === '2026-09-26')?.target.calories).toBe(2000)
  })

  it('adherence uses eligible tracked days, excludes today, and the calorie range', () => {
    const summary = summarizeNutrition(points, targets, TODAY)
    expect(summary.trackedDays).toBe(2)
    // 2,000 within 1,700–2,200; 2,300 above the range.
    expect(summary.nutrients.calories.adherence).toEqual({ met: 1, eligible: 2, rate: 0.5 })
    // 140 × 0.85 = 119: 120 meets, 118 does not.
    expect(summary.nutrients.proteinG.adherence).toEqual({ met: 1, eligible: 2, rate: 0.5 })
    expect(summary.nutrients.calories.averageActual).toBe(2150)
    expect(summary.nutrients.calories.averageTarget).toBe(2000)
  })

  it('uses the snapshot tolerance, not a hard-coded 85%', () => {
    const strict = targetsByDate(
      datesIn(period),
      datesIn(period).map((date) => snapshot(date, { nutrition_tolerance: 0.9 })),
      [],
    )
    const summary = summarizeNutrition(nutritionSeries(period, days, strict), strict, TODAY)
    expect(summary.nutrients.proteinG.adherence.met).toBe(0) // 126 needed
  })

  it('days without a snapshot tolerance are not eligible; no days means no rate', () => {
    const cycleOnly = targetsByDate(datesIn(period), [], [cycle({ periodStart: '2026-09-01' })])
    const summary = summarizeNutrition(nutritionSeries(period, days, cycleOnly), cycleOnly, TODAY)
    expect(summary.nutrients.calories.adherence).toEqual({ met: 0, eligible: 0, rate: null })
    expect(summary.nutrients.calories.averageTarget).toBe(2000)
    const none = summarizeNutrition(nutritionSeries(period, [], targets), targets, TODAY)
    expect(none.nutrients.calories.averageActual).toBeNull()
    expect(none.nutrients.calories.adherence.rate).toBeNull()
  })
})

describe('training', () => {
  const entry = (date: string, minutes = 45, calories = 270): TrainingEntry => ({
    date,
    durationMinutes: minutes,
    calories,
  })

  it('groups Monday–Sunday weeks overlapping the period', () => {
    expect(weeksOverlapping({ start: '2026-09-17', end: TODAY })).toEqual([
      { start: '2026-09-14', end: '2026-09-20' },
      { start: '2026-09-21', end: '2026-09-27' },
      { start: '2026-09-28', end: '2026-10-04' },
    ])
  })

  it('counts workout days per week with the shared rule; statuses for partial/in-progress', () => {
    const period = { start: '2026-09-07', end: TODAY }
    const cycles = [cycle({ periodStart: '2026-09-10' })] // starts on a Thursday
    const targets = targetsByDate(datesIn({ start: '2026-09-07', end: TODAY }), [], cycles)
    const weeks = weeklyTraining(
      period,
      [
        entry('2026-09-11'),
        entry('2026-09-15'),
        entry('2026-09-15'), // same day: one workout day
        entry('2026-09-16'),
        entry('2026-09-18'),
        entry('2026-09-19'),
        entry('2026-09-22'),
        entry('2026-09-28'),
      ],
      targets,
      cycles,
      TODAY,
    )
    expect(weeks.map((week) => [week.start, week.done, week.capacity, week.status])).toEqual([
      ['2026-09-07', 1, 4, 'partial'],
      ['2026-09-14', 4, 4, 'counted'],
      ['2026-09-21', 1, 4, 'counted'],
      ['2026-09-28', 1, 4, 'in-progress'],
    ])
    // Full weeks only; extra workouts never offset another week.
    expect(workoutAdherence(weeks)).toEqual({ done: 5, expected: 8, weeks: 2, rate: 0.625 })
  })

  it('weeks without a recommendation have no capacity and are never judged', () => {
    const weeks = weeklyTraining(
      { start: '2026-09-14', end: TODAY },
      [entry('2026-09-15')],
      new Map(),
      [],
      TODAY,
    )
    expect(weeks.every((week) => week.status === 'no-capacity')).toBe(true)
    expect(workoutAdherence(weeks)).toEqual({ done: 0, expected: 0, weeks: 0, rate: null })
  })

  it('caps a week at its capacity', () => {
    const cycles = [cycle({ periodStart: '2026-09-01', workout_days_per_week: 2 })]
    const targets = targetsByDate(datesIn({ start: '2026-09-14', end: TODAY }), [], cycles)
    const weeks = weeklyTraining(
      { start: '2026-09-14', end: '2026-09-20' },
      ['2026-09-14', '2026-09-15', '2026-09-16'].map((date) => entry(date)),
      targets,
      cycles,
      TODAY,
    )
    expect(workoutAdherence(weeks)).toEqual({ done: 2, expected: 2, weeks: 1, rate: 1 })
  })

  it('activity/workout totals: sessions, days, time, stored calories; null when none', () => {
    const period = { start: '2026-09-22', end: TODAY }
    expect(
      entryTotals(
        [entry('2026-09-22', 90, 450), entry('2026-09-22', 30, 200), entry('2026-09-01')],
        period,
      ),
    ).toEqual({ sessions: 2, days: 1, minutes: 120, calories: 650, averageMinutes: 60 })
    expect(entryTotals([], period)).toBeNull()
  })

  it('weekly minutes leave empty weeks empty', () => {
    expect(weeklyMinutes([entry('2026-09-22', 40)], { start: '2026-09-14', end: TODAY })).toEqual([
      { start: '2026-09-14', minutes: null },
      { start: '2026-09-21', minutes: 40 },
      { start: '2026-09-28', minutes: null },
    ])
  })
})

describe('body', () => {
  const weight = (
    date: string,
    kg: number,
    source: 'MANUAL' | 'INBODY',
    createdAt = `${date}T08:00:00Z`,
  ): WeightMeasurement => ({
    date,
    weightKg: kg,
    source,
    createdAt,
  })

  it('one weight per date: InBody wins, else the latest; nothing interpolated', () => {
    expect(
      weightSeries([
        weight('2026-09-10', 79.2, 'MANUAL', '2026-09-10T20:00:00Z'),
        weight('2026-09-10', 79.0, 'INBODY', '2026-09-10T08:00:00Z'),
        weight('2026-09-01', 80.0, 'MANUAL', '2026-09-01T07:00:00Z'),
        weight('2026-09-01', 80.4, 'MANUAL', '2026-09-01T21:00:00Z'),
      ]),
    ).toEqual([
      { date: '2026-09-01', weightKg: 80.4, source: 'MANUAL' },
      { date: '2026-09-10', weightKg: 79.0, source: 'INBODY' },
    ])
  })

  it('change is earliest → latest; single value has no change; none is null', () => {
    expect(
      change([
        { date: '2026-09-20', value: 74.9 },
        { date: '2026-09-01', value: 75.8 },
      ]),
    ).toEqual({
      first: { date: '2026-09-01', value: 75.8 },
      last: { date: '2026-09-20', value: 74.9 },
      delta: -0.9,
    })
    expect(change([{ date: '2026-09-01', value: 75.8 }])?.delta).toBeNull()
    expect(change([])).toBeNull()
  })

  it('body fat and muscle come only from recorded values', () => {
    const composition = [
      { date: '2026-09-20', bodyFatPercent: 22.4, muscleMassKg: null },
      { date: '2026-08-20', bodyFatPercent: 23.1, muscleMassKg: 31.4 },
    ]
    expect(change(compositionSeries(composition, 'bodyFatPercent'))?.delta).toBe(-0.7)
    expect(change(compositionSeries(composition, 'muscleMassKg'))?.delta).toBeNull()
    expect(hasBodyData({ weights: [], composition: [] })).toBe(false)
    expect(hasBodyData({ weights: [], composition })).toBe(true)
  })
})

describe('steps, goals and cycles', () => {
  it('steps average days with an entry only', () => {
    expect(
      stepsSummary([
        { date: '2026-09-01', steps: 8000 },
        { date: '2026-09-03', steps: 10001 },
      ]),
    ).toEqual({
      average: 9001,
      days: 2,
    })
    expect(stepsSummary([])).toBeNull()
  })

  it('goal progress works in both directions and never invents a percentage', () => {
    expect(goalProgress(80, 75, 70)).toBe(0.5) // loss
    expect(goalProgress(30, 31.5, 33)).toBe(0.5) // gain
    expect(goalProgress(80, 82, 70)).toBe(0) // moved away
    expect(goalProgress(80, 68, 70)).toBe(1) // passed the target
    expect(goalProgress(null, 75, 70)).toBeNull()
    expect(goalProgress(80, 75, null)).toBeNull()
    expect(goalProgress(70, 70, 70)).toBeNull()
  })

  it('a cycle is analysed from its start until today or its end', () => {
    expect(cyclePeriod({ periodStart: '2026-09-04', periodEnd: null }, TODAY)).toEqual({
      start: '2026-09-04',
      end: TODAY,
    })
    expect(cyclePeriod({ periodStart: '2026-08-04', periodEnd: '2026-09-03' }, TODAY)).toEqual({
      start: '2026-08-04',
      end: '2026-09-03',
    })
  })
})

describe('formatting', () => {
  it('percent, signed changes (percentage points) and week labels', () => {
    expect(formatPercent(0.727)).toBe('73%')
    expect(formatPercent(null)).toBe('—')
    expect(formatSigned(-0.9, 1, 'kg')).toBe('−0.9 kg')
    expect(formatSigned(0.6, 1, 'pp')).toBe('+0.6 pp')
    expect(formatSigned(0, 1, 'kg')).toBe('0 kg')
    expect(formatWeekLabel('2026-09-21', '2026-09-27')).toBe('Sep 21 – 27')
    expect(formatWeekLabel('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4')
  })
})
