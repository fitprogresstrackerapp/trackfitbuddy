import { z } from 'zod'

import type { Gender } from '@/features/auth/types'
import { addDays, ageOn, isValidIsoDate } from '@/lib/dates/local-date'
import { Constants } from '@/types/database'

import { FOCUS_TYPES, LONG_TERM_GOALS } from './lib/goals'

export const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
] as const satisfies readonly { value: Gender; label: string }[]

/** Sensible human ranges for onboarding (the database enforces wider hard limits). */
export const AGE_RANGE = { min: 13, max: 100 } as const
export const HEIGHT_RANGE_CM = { min: 100, max: 250 } as const
export const WEIGHT_RANGE_KG = { min: 25, max: 300 } as const
export const EARLIEST_DATE_OF_BIRTH = '1900-01-01'

/** Step 1 — name, date of birth (age is derived from it), gender. */
export function createBasicsSchema(today: string) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'Enter your name' })
      .max(100, { error: 'Use at most 100 characters' }),
    dateOfBirth: z
      .string()
      .min(1, { error: 'Enter your date of birth' })
      .refine(isValidIsoDate, { error: 'Enter a valid date' })
      .refine((value) => value < today, { error: 'Date of birth must be in the past' })
      .refine(
        (value) => {
          const age = ageOn(value, today)
          return age >= AGE_RANGE.min && age <= AGE_RANGE.max
        },
        { error: `Age must be between ${AGE_RANGE.min} and ${AGE_RANGE.max}` },
      ),
    gender: z.enum(Constants.public.Enums.gender, { error: 'Select an option' }),
  })
}

export type BasicsInput = z.output<ReturnType<typeof createBasicsSchema>>

function measurementField(
  label: string,
  unit: string,
  range: { min: number; max: number },
  decimals: number,
) {
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`)
  return z
    .string()
    .trim()
    .min(1, { error: `Enter your ${label}` })
    .regex(pattern, {
      error: `Enter a number with up to ${decimals} decimal place${decimals === 1 ? '' : 's'}`,
    })
    .transform(Number)
    .refine((value) => value >= range.min && value <= range.max, {
      error: `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} must be between ${range.min} and ${range.max} ${unit}`,
    })
}

/** Step 2 — metric body measurements. */
export const measurementsSchema = z.object({
  heightCm: measurementField('height', 'cm', HEIGHT_RANGE_CM, 1),
  weightKg: measurementField('weight', 'kg', WEIGHT_RANGE_KG, 2),
})

export type MeasurementsInput = z.output<typeof measurementsSchema>

/*
 * Profile editing (after onboarding) reuses the onboarding rules above for
 * personal details and height, and adds the schemas below. The database
 * constraints stay authoritative.
 */

/** Height alone, with the onboarding bounds. */
export const heightSchema = z.object({
  heightCm: measurementField('height', 'cm', HEIGHT_RANGE_CM, 1),
})

/** How far back a missing measurement can be added (mirrors log_weight / log_steps). */
export const ENTRY_WINDOW_DAYS = 90

function entryDate(today: string) {
  const earliest = addDays(today, -ENTRY_WINDOW_DAYS)
  return z
    .string()
    .refine(isValidIsoDate, { error: 'Enter a valid date' })
    .refine((value) => value <= today, { error: 'The date can’t be in the future' })
    .refine((value) => value >= earliest, {
      error: `Missing entries can be added for the last ${String(ENTRY_WINDOW_DAYS)} days`,
    })
}

/** A manual weight measurement. */
export function createWeightEntrySchema(today: string) {
  return z.object({
    weightKg: measurementField('weight', 'kg', WEIGHT_RANGE_KG, 2),
    date: entryDate(today),
  })
}

export type WeightEntryInput = z.output<ReturnType<typeof createWeightEntrySchema>>

/** Database maximum for one day's steps. */
export const STEPS_MAX = 200_000

/** A manual step entry: a whole, non-negative number for one day. */
export function createStepsEntrySchema(today: string) {
  return z.object({
    steps: z
      .string()
      .trim()
      .min(1, { error: 'Enter your steps' })
      .regex(/^\d+$/, { error: 'Use a whole number of steps' })
      .transform(Number)
      .refine((value) => value <= STEPS_MAX, {
        error: `Steps must be at most ${STEPS_MAX.toLocaleString('en-IN')}`,
      }),
    date: entryDate(today),
  })
}

export type StepsEntryInput = z.output<ReturnType<typeof createStepsEntrySchema>>

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use at most ${String(max)} characters` })
    .transform((value) => (value.length > 0 ? value : null))

/** Lifestyle context: activity level (optional), job, hobbies/sports. */
export const lifestyleSchema = z.object({
  activityLevel: z
    .union([z.enum(Constants.public.Enums.activity_level), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  job: optionalText(200),
  hobbies: optionalText(500),
})

export type LifestyleInput = z.output<typeof lifestyleSchema>

export const OBJECTIVE_MAX = 2000

/** Goals (spec §22): one long-term goal, several short-term focuses, free text. */
export const goalSchema = z.object({
  longTermGoal: z.enum(LONG_TERM_GOALS, { error: 'Choose a long-term goal' }),
  focuses: z
    .array(z.enum(FOCUS_TYPES))
    .max(FOCUS_TYPES.length)
    .refine((values) => new Set(values).size === values.length, {
      error: 'Choose each focus at most once',
    }),
  objective: optionalText(OBJECTIVE_MAX),
})

export type GoalInput = z.output<typeof goalSchema>

/** Workout capacity preference (spec §16): 2–6 days per week. */
export const capacitySchema = z.object({
  workoutDaysPerWeek: z
    .number({ error: 'Choose 2–6 days per week' })
    .int()
    .min(2, { error: 'Choose 2–6 days per week' })
    .max(6, { error: 'Choose 2–6 days per week' }),
})

const target = (label: string, min: number, max: number, decimals: number) =>
  z
    .string()
    .trim()
    .min(1, { error: `Enter ${label.toLowerCase()}` })
    .regex(decimals === 0 ? /^\d+$/ : /^\d+(\.\d)?$/, {
      error: decimals === 0 ? 'Use a whole number' : 'Use a number with up to 1 decimal',
    })
    .transform(Number)
    .refine((value) => value >= min && value <= max, {
      error: `${label} must be between ${String(min)} and ${String(max)}`,
    })

/**
 * Recommendation review (spec §33): final targets and the names of the
 * template's sessions. The session count is fixed by the cycle's capacity.
 */
export function createReviewSchema(sessionCount: number) {
  return z.object({
    calories: target('Calories', 800, 6000, 0),
    proteinG: target('Protein', 0, 500, 1),
    carbsG: target('Carbs', 0, 1000, 1),
    fatG: target('Fat', 0, 400, 1),
    fiberG: target('Fiber', 0, 150, 1),
    sessions: z
      .array(
        z
          .string()
          .trim()
          .min(1, { error: 'Name each session' })
          .max(60, { error: 'Use at most 60 characters' }),
      )
      .length(sessionCount, { error: `The template has ${String(sessionCount)} sessions` }),
  })
}

export type ReviewInput = z.output<ReturnType<typeof createReviewSchema>>
