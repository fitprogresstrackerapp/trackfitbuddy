import { z } from 'zod'

import { ACTIVITY_TYPE_LABELS } from '@/features/activity/lib/activity-types'
import { WORKOUT_TYPE_LABELS } from '@/features/workout/lib/workout-types'
import { LATE_ENTRY_DAYS } from '@/lib/dates/day-param'
import { addDays, isValidIsoDate } from '@/lib/dates/local-date'

import type { TrainingKind } from './types'

/*
 * Client-side validation for workout/activity entries. The database enforces
 * the hard limits (types, 1–1440 minutes, non-negative calories, locking,
 * dates); these give clear messages first.
 */

/** A whole day; long activities (a 4-hour cricket match) must stay possible. */
export const DURATION_MAX = 1440
export const MANUAL_CALORIES_MAX = 10_000
export const NAME_MAX = 60

const TYPES: Record<TrainingKind, readonly string[]> = {
  workout: Object.keys(WORKOUT_TYPE_LABELS),
  activity: Object.keys(ACTIVITY_TYPE_LABELS),
}

export function createTrainingSchema(kind: TrainingKind, today: string) {
  const earliest = addDays(today, -LATE_ENTRY_DAYS)
  return z
    .object({
      type: z.string().refine((value) => TYPES[kind].includes(value), { error: 'Select a type' }),
      name: z
        .string()
        .trim()
        .max(NAME_MAX, { error: `Use at most ${String(NAME_MAX)} characters` }),
      duration: z
        .string()
        .trim()
        .min(1, { error: 'Enter the duration' })
        .regex(/^\d+$/, { error: 'Use whole minutes' })
        .transform(Number)
        .refine((value) => value > 0, { error: 'Duration must be more than 0 minutes' })
        .refine((value) => value <= DURATION_MAX, {
          error: `Duration must be at most ${String(DURATION_MAX)} minutes`,
        }),
      manual: z.boolean(),
      manualCalories: z.string().trim(),
      date: z
        .string()
        .refine(isValidIsoDate, { error: 'Enter a valid date' })
        .refine((value) => value <= today, { error: 'The date can’t be in the future' })
        .refine((value) => value >= earliest, {
          error: `Missing entries can be added for the last ${String(LATE_ENTRY_DAYS)} days`,
        }),
    })
    .superRefine((value, ctx) => {
      if (value.type === 'CUSTOM' && value.name.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter a name for a custom entry' })
      }
      if (value.manual) {
        const calories = value.manualCalories
        if (calories.length === 0) {
          ctx.addIssue({ code: 'custom', path: ['manualCalories'], message: 'Enter the calories' })
        } else if (!/^\d+(\.\d)?$/.test(calories)) {
          ctx.addIssue({
            code: 'custom',
            path: ['manualCalories'],
            message: 'Use a non-negative number with up to 1 decimal',
          })
        } else if (Number(calories) > MANUAL_CALORIES_MAX) {
          ctx.addIssue({
            code: 'custom',
            path: ['manualCalories'],
            message: `Calories must be at most ${MANUAL_CALORIES_MAX.toLocaleString('en-IN')}`,
          })
        }
      }
    })
    .transform((value) => ({
      type: value.type,
      name: value.name.length > 0 ? value.name : null,
      durationMinutes: value.duration,
      manualCalories: value.manual ? Number(value.manualCalories) : null,
      date: value.date,
    }))
}

export type TrainingInput = z.output<ReturnType<typeof createTrainingSchema>>
export type TrainingFormValues = z.input<ReturnType<typeof createTrainingSchema>>
export type TrainingField = keyof TrainingFormValues
