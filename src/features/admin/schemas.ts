import { z } from 'zod'

import { normalizeIndianPhone } from '@/features/auth/lib/phone'
import { STEPS_MAX } from '@/features/profile/schemas'

/*
 * Admin form validation (UX only: every rule is enforced again on the
 * server). Ranges mirror the database and the existing user-facing forms.
 */

const pin = z.string().regex(/^[0-9]{4}$/, { error: 'Enter exactly 4 digits' })
const reason = z
  .string()
  .trim()
  .max(500, { error: 'Use at most 500 characters' })
  .transform((value) => (value.length === 0 ? null : value))

export const createUserSchema = z.object({
  phone: z
    .string()
    .transform((value) => normalizeIndianPhone(value))
    .refine((value): value is string => value !== null, {
      error: 'Enter a 10-digit Indian mobile number starting with 6–9',
    }),
  pin,
  role: z.enum(['USER', 'MANAGER', 'ADMIN']),
})

export const resetPinSchema = z.object({ pin, reason })

export const reasonSchema = z.object({ reason })

const numberField = (label: string, min: number, max: number, decimals: number) =>
  z
    .string()
    .trim()
    .min(1, { error: `Enter ${label}` })
    .regex(decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${String(decimals)}})?$`), {
      error: decimals === 0 ? 'Use a whole number' : `Use up to ${String(decimals)} decimals`,
    })
    .transform(Number)
    .refine((value) => value >= min && value <= max, {
      error: `Must be ${String(min)}–${String(max)}`,
    })

const optionalNumber = (label: string, min: number, max: number, decimals: number) =>
  z.union([z.literal('').transform(() => null), numberField(label, min, max, decimals)])

export const correctionSchemas = {
  quantity: numberField('a quantity', 0.01, 100000, 2),
  steps: numberField('steps', 0, STEPS_MAX, 0),
  weight: numberField('a weight', 20, 400, 2),
  duration: numberField('a duration', 1, 1440, 0),
  manualCalories: optionalNumber('calories', 0, 10000, 1),
  bodyFat: optionalNumber('body fat', 0, 100, 1),
  muscle: optionalNumber('muscle mass', 0, 200, 2),
  inbodyWeight: optionalNumber('weight', 20, 400, 2),
  bmi: optionalNumber('BMI', 5, 100, 1),
  bmr: optionalNumber('BMR', 500, 5000, 0),
  height: numberField('a height', 100, 250, 1),
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter a name' })
    .max(100, { error: 'Use at most 100 characters' }),
  customName: z
    .string()
    .trim()
    .max(60, { error: 'Use at most 60 characters' })
    .transform((value) => (value.length === 0 ? null : value)),
}
