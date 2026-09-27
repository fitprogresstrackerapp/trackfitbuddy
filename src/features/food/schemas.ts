import { z } from 'zod'

/*
 * Client-side validation for food input. The database enforces the hard
 * limits (positive quantities, non-negative nutrition, unit format); these
 * give clear messages and sane human ranges first.
 */

export const QUANTITY_MAX = 10_000
export const SERVING_MAX = 5_000
export const CALORIES_MAX = 5_000
export const MACRO_MAX = 1_000

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/

function decimalField(options: {
  required: string
  min: number
  minInclusive: boolean
  max: number
  label: string
}) {
  return z
    .string()
    .trim()
    .min(1, { error: options.required })
    .refine((value) => TWO_DECIMALS.test(value), { error: 'Use a number with up to 2 decimals' })
    .transform(Number)
    .refine((value) => Number.isFinite(value), { error: 'Enter a valid number' })
    .refine((value) => (options.minInclusive ? value >= options.min : value > options.min), {
      error: options.minInclusive
        ? `${options.label} can’t be negative`
        : `${options.label} must be more than 0`,
    })
    .refine((value) => value <= options.max, {
      error: `${options.label} must be at most ${options.max.toLocaleString('en-IN')}`,
    })
}

export const quantitySchema = decimalField({
  required: 'Enter a quantity',
  min: 0,
  minInclusive: false,
  max: QUANTITY_MAX,
  label: 'Quantity',
})

const nutrient = (label: string, max: number) =>
  decimalField({ required: `Enter ${label.toLowerCase()}`, min: 0, minInclusive: true, max, label })

/** A user-submitted food (spec §11): name and nutrition per serving. */
export const foodSubmissionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Enter the food name' })
    .max(120, { error: 'Use at most 120 characters' }),
  servingQuantity: decimalField({
    required: 'Enter the serving size',
    min: 0,
    minInclusive: false,
    max: SERVING_MAX,
    label: 'Serving size',
  }),
  servingUnit: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z ]{0,19}$/, { error: 'Use a simple unit such as g, ml, piece or bowl' }),
  calories: nutrient('Calories', CALORIES_MAX),
  proteinG: nutrient('Protein', MACRO_MAX),
  carbsG: nutrient('Carbs', MACRO_MAX),
  fatG: nutrient('Fat', MACRO_MAX),
  fiberG: nutrient('Fiber', MACRO_MAX),
})

export type FoodSubmissionInput = z.output<typeof foodSubmissionSchema>
export type FoodSubmissionField = keyof z.input<typeof foodSubmissionSchema>
