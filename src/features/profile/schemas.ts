import { z } from 'zod'

import type { Gender } from '@/features/auth/types'
import { ageOn, isValidIsoDate } from '@/lib/dates/local-date'
import { Constants } from '@/types/database'

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
