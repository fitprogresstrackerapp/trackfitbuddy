import { describe, expect, it } from 'vitest'

import { addDays } from '../../../lib/dates/local-date'
import {
  analysisWindow,
  buildRecommendationInput,
  InputNotReadyError,
  readinessIssue,
  type InputSource,
  type SourceCycle,
} from './input-builder'
import { recommendationInputSchema } from './input'
import type { CycleInfo, SnapshotInfo } from '../../progress/types'

/*
 * Processing on Monday 2026-10-05. The previous cycle started Friday
 * 2026-09-04, so its first week (Aug 31 – Sep 6) is a transition week and
 * the four weeks Sep 7 – Oct 4 are full weeks judged at 4 days/week.
 */
const TODAY = '2026-10-05'
const PREVIOUS_START = '2026-09-04'

function snapshotsFor(
  start: string,
  end: string,
  targets: { calories: number; workouts: number },
): SnapshotInfo[] {
  const rows: SnapshotInfo[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    rows.push({
      target_date: date,
      calories: targets.calories,
      protein_g: 140,
      carbs_g: 230,
      fat_g: 65,
      fiber_g: 30,
      workouts_per_week: targets.workouts,
      nutrition_tolerance: 0.85,
      calorie_lower_tolerance: 0.85,
      calorie_upper_tolerance: 1.1,
    })
  }
  return rows
}

const OLDER_CYCLE: CycleInfo = {
  id: 'older',
  status: 'LOCKED',
  periodStart: '2026-08-04',
  periodEnd: '2026-09-03',
  reviewDeadline: '2026-08-05',
  goalId: 'goal-old',
  workout_days_per_week: 3,
  final_calories: 1800,
  final_protein_g: 130,
  final_carbs_g: 200,
  final_fat_g: 60,
  final_fiber_g: 30,
}

const PREVIOUS_CYCLE: SourceCycle = {
  id: 'previous',
  status: 'LOCKED',
  periodStart: PREVIOUS_START,
  periodEnd: null,
  reviewDeadline: '2026-09-05',
  goalId: 'goal-a',
  workout_days_per_week: 4,
  final_calories: 2000,
  final_protein_g: 140,
  final_carbs_g: 230,
  final_fat_g: 65,
  final_fiber_g: 30,
  recommended: { calories: 1900, proteinG: 140, carbsG: 230, fatG: 65, fiberG: 30 },
  parsedOutput: { summary: 'Keep protein high.', short_term_focus: ['MUSCLE_BUILDING'] },
  workoutPlan: {
    sessions: [
      { name: 'Upper', type: 'UPPER_BODY' },
      { name: 'Lower', type: 'LOWER_BODY' },
      { name: 'Full', type: 'FULL_BODY' },
      'Athletic',
    ],
  },
}

const workout = (date: string, type = 'LEGS') => ({
  date,
  type,
  durationMinutes: 45,
  calories: 270,
})

// Full weeks: 4 + 3 + 4 (5 days capped at capacity) + 3 = 14 of 16.
const WORKOUTS = [
  workout('2026-09-01'), // transition week (before the cycle): never judged
  ...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-10'].map((date) =>
    workout(date, 'UPPER_BODY'),
  ),
  ...['2026-09-14', '2026-09-16', '2026-09-18'].map((date) => workout(date)),
  ...['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((date) =>
    workout(date, 'CARDIO'),
  ),
  ...['2026-09-28', '2026-09-30', '2026-10-02'].map((date) => workout(date)),
]

function source(overrides: Partial<InputSource> = {}): InputSource {
  return {
    processingDate: TODAY,
    profile: {
      dateOfBirth: '1996-03-10',
      gender: 'MALE',
      heightCm: 175,
      activityLevel: 'MODERATELY_ACTIVE',
      job: '  Software engineer ',
      hobbies: 'Cricket',
      workoutDaysPerWeek: 5,
      missingFields: [],
    },
    goal: {
      id: 'goal-b',
      longTermGoal: 'MUSCLE_GAIN',
      description: 'Stronger for the cricket season.',
      focuses: ['CRICKET_PERFORMANCE', 'MUSCLE_BUILDING'],
    },
    previousCycle: PREVIOUS_CYCLE,
    cycles: [OLDER_CYCLE, PREVIOUS_CYCLE],
    snapshots: [
      ...snapshotsFor('2026-08-31', '2026-09-03', { calories: 1800, workouts: 3 }),
      ...snapshotsFor(PREVIOUS_START, '2026-10-04', { calories: 2000, workouts: 4 }),
    ],
    nutritionDays: [
      // 1,950 kcal is within 85–110 %; fiber 25 < 30 × 0.85.
      {
        date: '2026-09-05',
        calories: 1950,
        proteinG: 130,
        carbsG: 230,
        fatG: 60,
        fiberG: 25,
        itemCount: 5,
      },
      // 2,500 kcal is above 110 %.
      {
        date: '2026-09-06',
        calories: 2500,
        proteinG: 150,
        carbsG: 300,
        fatG: 80,
        fiberG: 30,
        itemCount: 7,
      },
    ],
    workouts: WORKOUTS,
    activities: [
      { date: '2026-09-12', type: 'CRICKET', durationMinutes: 60, calories: 300 },
      { date: '2026-09-19', type: 'WALKING', durationMinutes: 30, calories: 100 },
    ],
    weights: [
      { date: '2026-09-05', weightKg: 75, source: 'MANUAL', createdAt: '2026-09-05T03:00:00Z' },
      { date: '2026-09-20', weightKg: 74.6, source: 'MANUAL', createdAt: '2026-09-20T09:00:00Z' },
      { date: '2026-09-20', weightKg: 74.2, source: 'INBODY', createdAt: '2026-09-20T03:00:00Z' },
      { date: '2026-10-02', weightKg: 74.1, source: 'MANUAL', createdAt: '2026-10-02T03:00:00Z' },
    ],
    composition: [
      { date: '2026-09-20', bodyFatPercent: 22.4, muscleMassKg: 32 },
      { date: '2026-10-01', bodyFatPercent: 21.9, muscleMassKg: 32.3 },
    ],
    steps: [
      { date: '2026-09-10', steps: 8000 },
      { date: '2026-09-11', steps: 10000 },
    ],
    currentWeight: { date: '2026-10-02', weightKg: 74.1 },
    latestInbody: { date: '2026-10-01', weightKg: 74.3, bodyFatPercent: 21.9, muscleMassKg: 32.3 },
    feedback: '  The split felt hard.  ',
    ...overrides,
  }
}

describe('readiness', () => {
  it('requires the onboarding fields, a goal and a capacity — nothing optional', () => {
    expect(readinessIssue(source())).toBeNull()
    expect(
      readinessIssue(source({ profile: { ...source().profile, missingFields: ['height_cm'] } })),
    ).toBe('Profile incomplete')
    expect(readinessIssue(source({ goal: null }))).toBe('No goals configured')
    expect(
      readinessIssue(source({ profile: { ...source().profile, workoutDaysPerWeek: null } })),
    ).toBe('No workout capacity configured')
    // No InBody, steps, feedback or history: still ready.
    expect(
      readinessIssue(
        source({ latestInbody: null, steps: [], feedback: null, previousCycle: null }),
      ),
    ).toBeNull()
  })

  it('a user who is not ready is never given an input', () => {
    expect(() => buildRecommendationInput(source({ goal: null }))).toThrow(InputNotReadyError)
  })
})

describe('analysis window', () => {
  it('is the previous cycle up to the day before processing, widened to whole weeks', () => {
    expect(analysisWindow(TODAY, PREVIOUS_CYCLE)).toEqual({
      period: { start: PREVIOUS_START, end: '2026-10-04' },
      fetched: { start: '2026-08-31', end: '2026-10-04' },
      kind: 'previous-cycle',
    })
  })

  it('is the last 28 completed days for a first recommendation', () => {
    expect(analysisWindow(TODAY, null).period).toEqual({ start: '2026-09-07', end: '2026-10-04' })
  })
})

describe('complete user with a previous cycle', () => {
  const input = buildRecommendationInput(source())
  const summary = input.previous_cycle?.summary

  it('is valid against the versioned schema', () => {
    expect(recommendationInputSchema.parse(input)).toEqual(input)
    expect(input.schema_version).toBe('recommendation-input-v1')
    expect(input.processing_date).toBe(TODAY)
    expect(input.first_recommendation).toBe(false)
    expect(input.recent_data).toBeNull()
  })

  it('describes the user compactly, trimming free text', () => {
    expect(input.user).toEqual({
      age: 30,
      gender: 'male',
      height_cm: 175,
      current_weight_kg: 74.1,
      current_weight_date: '2026-10-02',
      activity_level: 'moderately_active',
      job: 'Software engineer',
      hobbies: 'Cricket',
    })
    expect(input.feedback).toBe('The split felt hard.')
  })

  it('uses the NEW goal version and capacity, while the previous cycle keeps its own', () => {
    expect(input.goals).toEqual({
      long_term: 'muscle_gain',
      short_term: ['cricket_performance', 'muscle_building'],
      objective: 'Stronger for the cricket season.',
    })
    expect(input.workout.days_per_week).toBe(5)
    expect(input.previous_cycle?.workout_days_per_week).toBe(4)
    expect(summary?.workouts.days_expected).toBe(16)
  })

  it('nutrition adherence = days meeting the day’s snapshot target / eligible tracked days', () => {
    expect(summary?.nutrition.tracked_days).toBe(2)
    expect(summary?.nutrition.calories).toEqual({
      average: 2225,
      target: 2000,
      days_met: 1,
      eligible_days: 2,
      adherence: 0.5,
    })
    expect(summary?.nutrition.protein_g.adherence).toBe(1)
    expect(summary?.nutrition.fiber_g).toMatchObject({ days_met: 1, eligible_days: 2 })
  })

  it('never counts the processing day (incomplete) in the summary', () => {
    const withToday = buildRecommendationInput(
      source({
        nutritionDays: [
          ...source().nutritionDays,
          {
            date: TODAY,
            calories: 400,
            proteinG: 20,
            carbsG: 50,
            fatG: 10,
            fiberG: 2,
            itemCount: 1,
          },
        ],
      }),
    )
    expect(withToday.previous_cycle?.summary.nutrition).toEqual(summary?.nutrition)
  })

  it('workout days: Monday–Sunday full weeks, distinct days, capped at capacity', () => {
    expect(summary?.workouts).toMatchObject({
      full_weeks: 4,
      days_completed: 14,
      days_expected: 16,
      adherence: 0.875,
      // Distinct days inside the cycle (the Sep 1 workout is before it).
      workout_days: 15,
      sessions: 16,
    })
    expect(summary?.workouts.types).toEqual({ UPPER_BODY: 5, LEGS: 6, CARDIO: 5 })
  })

  it('activities are summarised separately and never counted as workouts', () => {
    expect(summary?.activities).toEqual({
      sessions: 2,
      days: 2,
      minutes: 90,
      calories: 400,
      types: { CRICKET: 1, WALKING: 1 },
    })
  })

  it('steps: average of days with an entry', () => {
    expect(summary?.steps).toEqual({ tracked_days: 2, average: 9000 })
  })

  it('body: observed first → last values, InBody over manual on the same date', () => {
    expect(summary?.body.weight_kg).toEqual({ start: 75, end: 74.1, change: -0.9 })
    expect(summary?.body.body_fat_percent).toEqual({ start: 22.4, end: 21.9, change: -0.5 })
    expect(summary?.body.muscle_mass_kg).toEqual({ start: 32, end: 32.3, change: 0.3 })
    expect(input.inbody).toEqual({
      date: '2026-10-01',
      weight_kg: 74.3,
      body_fat_percent: 21.9,
      muscle_mass_kg: 32.3,
    })
  })

  it('includes the previous final recommendation (not the raw AI output)', () => {
    expect(input.previous_recommendation).toEqual({
      generated_on: PREVIOUS_START,
      targets: { calories: 2000, protein_g: 140, carbs_g: 230, fat_g: 65, fiber_g: 30 },
      edited_by_user: true,
      workout_template: [
        { name: 'Upper', type: 'UPPER_BODY' },
        { name: 'Lower', type: 'LOWER_BODY' },
        { name: 'Full', type: 'FULL_BODY' },
        { name: 'Athletic', type: null },
      ],
      focus: ['MUSCLE_BUILDING'],
      summary: 'Keep protein high.',
    })
  })
})

describe('missing data stays missing', () => {
  it('first recommendation: no previous cycle or recommendation, recent data without targets', () => {
    const input = buildRecommendationInput(
      source({ previousCycle: null, cycles: [], snapshots: [] }),
    )
    expect(input.first_recommendation).toBe(true)
    expect(input.previous_cycle).toBeNull()
    expect(input.previous_recommendation).toBeNull()
    expect(input.recent_data).toMatchObject({ start: '2026-09-07', end: '2026-10-04' })
    // No snapshots → nothing is eligible; adherence is unknown, not 0.
    expect(input.recent_data?.nutrition.calories).toMatchObject({
      target: null,
      eligible_days: 0,
      adherence: null,
    })
    expect(input.recent_data?.workouts).toMatchObject({ days_expected: 0, adherence: null })
  })

  it('no InBody → null (never inferred); a report after the processing date is ignored', () => {
    expect(buildRecommendationInput(source({ latestInbody: null })).inbody).toBeNull()
    expect(
      buildRecommendationInput(
        source({
          latestInbody: { date: '2026-10-06', weightKg: 70, bodyFatPercent: 20, muscleMassKg: 33 },
        }),
      ).inbody,
    ).toBeNull()
  })

  it('no steps → average null, never 0', () => {
    const summary = buildRecommendationInput(source({ steps: [] })).previous_cycle?.summary
    expect(summary?.steps).toEqual({ tracked_days: 0, average: null })
  })

  it('no weight → nulls, never 0', () => {
    const input = buildRecommendationInput(
      source({ weights: [], composition: [], currentWeight: null }),
    )
    expect(input.user.current_weight_kg).toBeNull()
    expect(input.previous_cycle?.summary.body).toEqual({
      weight_kg: { start: null, end: null, change: null },
      body_fat_percent: { start: null, end: null, change: null },
      muscle_mass_kg: { start: null, end: null, change: null },
    })
  })

  it('a single measurement has no change', () => {
    const summary = buildRecommendationInput(
      source({
        weights: [
          { date: '2026-09-05', weightKg: 75, source: 'MANUAL', createdAt: '2026-09-05T03:00:00Z' },
        ],
      }),
    ).previous_cycle?.summary
    expect(summary?.body.weight_kg).toEqual({ start: 75, end: 75, change: null })
  })

  it('blank free text and feedback become null', () => {
    const input = buildRecommendationInput(
      source({ feedback: '   ', profile: { ...source().profile, job: ' ', hobbies: null } }),
    )
    expect(input.feedback).toBeNull()
    expect(input.user.job).toBeNull()
    expect(input.user.hobbies).toBeNull()
  })
})
