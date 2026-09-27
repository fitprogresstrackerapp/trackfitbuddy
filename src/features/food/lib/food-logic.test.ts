import { describe, expect, it } from 'vitest'

import type { LoggedMeal } from '../types'
import {
  dayKind,
  existingMealFor,
  formatQuantity,
  friendlyError,
  isEditable,
  mealLabel,
  mealTotals,
  previewNutrition,
  quantityPresets,
  resolveDateParam,
  sumPreviews,
} from './food-logic'

const TODAY = '2026-09-27'

function meal(overrides: Partial<LoggedMeal> = {}): LoggedMeal {
  return {
    id: 'meal-1',
    date: TODAY,
    category: null,
    name: null,
    isLocked: false,
    copiedFromMealId: null,
    createdAt: '2026-09-27T03:00:00Z',
    meal_items: [],
    ...overrides,
  }
}

const CHICKEN = {
  servingQuantity: 100,
  calories: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  fiberG: 0,
}

describe('resolveDateParam', () => {
  it('defaults to today', () => {
    expect(resolveDateParam(null, TODAY)).toEqual({ date: TODAY, valid: true })
  })
  it('accepts a valid past date', () => {
    expect(resolveDateParam('2026-09-20', TODAY)).toEqual({ date: '2026-09-20', valid: true })
  })
  it.each(['2026-09-28', '2027-01-01'])('falls back to today for a future date (%s)', (raw) => {
    expect(resolveDateParam(raw, TODAY)).toEqual({ date: TODAY, valid: false })
  })
  it.each(['2026-02-31', 'yesterday', '27-09-2026', '', '2026-9-1'])(
    'falls back to today for an invalid date (%s)',
    (raw) => {
      expect(resolveDateParam(raw, TODAY)).toEqual({ date: TODAY, valid: false })
    },
  )
})

describe('dayKind', () => {
  it('today, future, and past within/outside the late-entry window', () => {
    expect(dayKind(TODAY, TODAY)).toEqual({ kind: 'today' })
    expect(dayKind('2026-09-28', TODAY)).toEqual({ kind: 'future' })
    expect(dayKind('2026-09-26', TODAY)).toEqual({ kind: 'past', lateEntry: true })
    expect(dayKind('2026-06-29', TODAY)).toEqual({ kind: 'past', lateEntry: true }) // 90 days
    expect(dayKind('2026-06-28', TODAY)).toEqual({ kind: 'past', lateEntry: false }) // 91 days
  })
})

describe('isEditable', () => {
  it('only today’s unlocked meals are editable', () => {
    expect(isEditable(meal(), TODAY)).toBe(true)
    expect(isEditable(meal({ isLocked: true }), TODAY)).toBe(false)
    expect(isEditable(meal({ date: '2026-09-26' }), TODAY)).toBe(false)
  })
})

describe('mealLabel', () => {
  it('uses the category, else a name, else a neutral "Meal"', () => {
    expect(mealLabel(meal({ category: 'BREAKFAST' }))).toBe('Breakfast')
    expect(mealLabel(meal({ name: 'Post-workout' }))).toBe('Post-workout')
    expect(mealLabel(meal({ name: '  ' }))).toBe('Meal')
    expect(mealLabel(meal())).toBe('Meal')
  })
})

describe('previewNutrition', () => {
  it('scales per-serving values by quantity / serving size', () => {
    expect(previewNutrition(CHICKEN, 200)).toEqual({
      calories: 330,
      proteinG: 62,
      carbsG: 0,
      fatG: 7.2,
      fiberG: 0,
    })
    expect(previewNutrition(CHICKEN, 150)?.proteinG).toBe(46.5)
  })
  it('rounds for display without long decimals', () => {
    expect(previewNutrition({ ...CHICKEN, proteinG: 1.3, servingQuantity: 3 }, 1)?.proteinG).toBe(
      0.4,
    )
  })
  it('has no preview for invalid quantities', () => {
    expect(previewNutrition(CHICKEN, 0)).toBeNull()
    expect(previewNutrition(CHICKEN, -1)).toBeNull()
    expect(previewNutrition(CHICKEN, Number.NaN)).toBeNull()
  })
})

describe('meal and draft totals', () => {
  it('sum snapshots / previews', () => {
    const item = (calories: number, protein: number) => ({
      id: String(calories),
      foodName: 'x',
      quantity: 1,
      unit: 'g',
      isUserFood: false,
      isApproximate: false,
      snapshot_calories: calories,
      snapshot_protein_g: protein,
      snapshot_carbs_g: 1,
      snapshot_fat_g: 1,
      snapshot_fiber_g: 0.1,
    })
    expect(mealTotals(meal({ meal_items: [item(330, 62), item(210, 2.6)] }))).toEqual({
      calories: 540,
      proteinG: 64.6,
      carbsG: 2,
      fatG: 2,
      fiberG: 0.2,
    })
    expect(sumPreviews([null, previewNutrition(CHICKEN, 100)])).toMatchObject({ calories: 165 })
  })
})

describe('quantities', () => {
  it('offers ½, 1, 1½ and 2 servings in the food’s own unit', () => {
    expect(quantityPresets(100)).toEqual([50, 100, 150, 200])
    expect(quantityPresets(1)).toEqual([0.5, 1, 1.5, 2])
    expect(formatQuantity(1.5, 'piece')).toBe('1.5 piece')
    expect(formatQuantity(200, 'g')).toBe('200 g')
  })
})

describe('existingMealFor', () => {
  const lunch = meal({ id: 'lunch', category: 'LUNCH' })
  const lockedDinner = meal({ id: 'dinner', category: 'DINNER', isLocked: true })
  const plain = meal({ id: 'plain' })

  it('adds to today’s editable meal of the same category', () => {
    expect(existingMealFor([plain, lunch], 'LUNCH', TODAY)?.id).toBe('lunch')
  })
  it('creates a new meal when the category has no editable meal', () => {
    expect(existingMealFor([lockedDinner], 'DINNER', TODAY)).toBeNull()
    expect(existingMealFor([lunch], 'BREAKFAST', TODAY)).toBeNull()
  })
  it('never merges uncategorised meals automatically', () => {
    expect(existingMealFor([plain], null, TODAY)).toBeNull()
  })
})

describe('friendlyError', () => {
  it('never exposes database internals', () => {
    const message = friendlyError(
      {
        code: 'XX000',
        message: 'duplicate key value violates unique constraint "meals_pkey"',
      },
      'Couldn’t add this food. Please try again.',
    )
    expect(message).toBe('Couldn’t add this food. Please try again.')
    expect(message).not.toMatch(/constraint|meals_pkey|Postgrest/)
  })
  it('explains locked records, future dates and the late-entry window', () => {
    expect(
      friendlyError({ code: '42501', message: 'Record is locked and can no longer be changed' }),
    ).toMatch(/locked/i)
    expect(
      friendlyError({ code: '22023', message: 'Food cannot be logged for a future date' }),
    ).toBe('Food can’t be logged for a future date.')
    expect(
      friendlyError({
        code: '22023',
        message: 'Missing food can be added for the last 90 days only',
      }),
    ).toMatch(/last 90 days/)
  })
  it('recognises network failures', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/connection/i)
  })
})
