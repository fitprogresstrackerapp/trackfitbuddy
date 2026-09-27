import { describe, expect, it } from 'vitest'

import { foodSubmissionSchema, quantitySchema } from './schemas'

const firstError = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message

describe('quantitySchema', () => {
  it.each([
    ['1', 1],
    ['1.5', 1.5],
    ['200', 200],
    [' 0.25 ', 0.25],
  ])('accepts %s', (input, expected) => {
    expect(quantitySchema.parse(input)).toBe(expected)
  })

  it.each([
    ['', 'Enter a quantity'],
    ['0', 'Quantity must be more than 0'],
    ['-1', 'Use a number with up to 2 decimals'],
    ['1.234', 'Use a number with up to 2 decimals'],
    ['abc', 'Use a number with up to 2 decimals'],
    ['NaN', 'Use a number with up to 2 decimals'],
    ['Infinity', 'Use a number with up to 2 decimals'],
    ['1e3', 'Use a number with up to 2 decimals'],
    ['10001', 'Quantity must be at most 10,000'],
  ])('rejects %j', (input, message) => {
    expect(firstError(quantitySchema.safeParse(input))).toBe(message)
  })
})

describe('foodSubmissionSchema', () => {
  const valid = {
    name: '  Home dal ',
    servingQuantity: '1',
    servingUnit: ' Bowl ',
    calories: '180',
    proteinG: '9',
    carbsG: '24.5',
    fatG: '5',
    fiberG: '0',
  }

  it('parses and normalises a valid food', () => {
    expect(foodSubmissionSchema.parse(valid)).toEqual({
      name: 'Home dal',
      servingQuantity: 1,
      servingUnit: 'bowl',
      calories: 180,
      proteinG: 9,
      carbsG: 24.5,
      fatG: 5,
      fiberG: 0,
    })
  })

  it('requires a name', () => {
    expect(firstError(foodSubmissionSchema.safeParse({ ...valid, name: ' ' }))).toBe(
      'Enter the food name',
    )
  })

  it.each(['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const)(
    'rejects negative %s rather than clamping it',
    (field) => {
      const result = foodSubmissionSchema.safeParse({ ...valid, [field]: '-1' })
      expect(result.success).toBe(false)
    },
  )

  it('rejects non-numeric and out-of-range values', () => {
    expect(foodSubmissionSchema.safeParse({ ...valid, calories: 'lots' }).success).toBe(false)
    expect(foodSubmissionSchema.safeParse({ ...valid, calories: '5001' }).success).toBe(false)
    expect(foodSubmissionSchema.safeParse({ ...valid, proteinG: '1001' }).success).toBe(false)
    expect(foodSubmissionSchema.safeParse({ ...valid, servingQuantity: '0' }).success).toBe(false)
  })

  it('accepts only simple serving units', () => {
    expect(foodSubmissionSchema.safeParse({ ...valid, servingUnit: 'piece' }).success).toBe(true)
    expect(foodSubmissionSchema.safeParse({ ...valid, servingUnit: '100g' }).success).toBe(false)
    expect(foodSubmissionSchema.safeParse({ ...valid, servingUnit: '' }).success).toBe(false)
  })
})
