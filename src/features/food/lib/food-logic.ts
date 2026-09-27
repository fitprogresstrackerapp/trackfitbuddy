import { LATE_ENTRY_DAYS } from '@/lib/dates/day-param'

import type { FoodOption, LoggedMeal, MealCategory } from '../types'

/*
 * Pure Food rules. The database is authoritative for nutrition (snapshots),
 * locking and late entry; these helpers only decide what the UI offers and
 * how it previews values before saving.
 */

export { dayKind, LATE_ENTRY_DAYS, resolveDateParam, type DayKind } from '@/lib/dates/day-param'

export const MEAL_CATEGORIES: readonly { value: MealCategory; label: string }[] = [
  { value: 'BREAKFAST', label: 'Breakfast' },
  { value: 'LUNCH', label: 'Lunch' },
  { value: 'DINNER', label: 'Dinner' },
  { value: 'SNACKS', label: 'Snacks' },
]

export function categoryLabel(category: MealCategory | null): string {
  return MEAL_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'Meal'
}

export function mealLabel(meal: Pick<LoggedMeal, 'category' | 'name'>): string {
  if (meal.category) return categoryLabel(meal.category)
  const name = meal.name?.trim() ?? ''
  return name.length > 0 ? name : 'Meal'
}

/** Only today's unlocked meals can be changed (the database enforces the same). */
export function isEditable(meal: Pick<LoggedMeal, 'date' | 'isLocked'>, today: string): boolean {
  return meal.date === today && !meal.isLocked
}

export interface NutritionPreview {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Preview only: value per serving × quantity / serving size. The saved values
 * are computed by the database trigger from the same inputs.
 */
export function previewNutrition(
  food: Pick<
    FoodOption,
    'servingQuantity' | 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'
  >,
  quantity: number,
): NutritionPreview | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || food.servingQuantity <= 0) return null
  const factor = quantity / food.servingQuantity
  return {
    calories: Math.round(food.calories * factor),
    proteinG: round1(food.proteinG * factor),
    carbsG: round1(food.carbsG * factor),
    fatG: round1(food.fatG * factor),
    fiberG: round1(food.fiberG * factor),
  }
}

export function sumPreviews(previews: readonly (NutritionPreview | null)[]): NutritionPreview {
  return previews.reduce<NutritionPreview>(
    (sum, preview) =>
      preview
        ? {
            calories: sum.calories + preview.calories,
            proteinG: round1(sum.proteinG + preview.proteinG),
            carbsG: round1(sum.carbsG + preview.carbsG),
            fatG: round1(sum.fatG + preview.fatG),
            fiberG: round1(sum.fiberG + preview.fiberG),
          }
        : sum,
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  )
}

/** Totals of one saved meal, from its snapshots. */
export function mealTotals(meal: Pick<LoggedMeal, 'meal_items'>): NutritionPreview {
  return sumPreviews(
    meal.meal_items.map((item) => ({
      calories: item.snapshot_calories,
      proteinG: item.snapshot_protein_g,
      carbsG: item.snapshot_carbs_g,
      fatG: item.snapshot_fat_g,
      fiberG: item.snapshot_fiber_g,
    })),
  )
}

/** Quick quantities in the food's own unit: ½, 1, 1½ and 2 servings. */
export function quantityPresets(servingQuantity: number): number[] {
  return [0.5, 1, 1.5, 2].map((factor) => Math.round(servingQuantity * factor * 100) / 100)
}

/** "200 g", "1.5 piece" — the unit is always the food's own serving unit. */
export function formatQuantity(quantity: number, unit: string): string {
  const value = Number.isInteger(quantity)
    ? String(quantity)
    : String(Math.round(quantity * 100) / 100)
  return `${value} ${unit}`
}

/**
 * Where new foods for `category` on today go: into today's editable meal of
 * that category if one exists (no duplicate Lunch), otherwise a new meal.
 * Uncategorised meals are never merged automatically.
 */
export function existingMealFor(
  meals: readonly LoggedMeal[],
  category: MealCategory | null,
  today: string,
): LoggedMeal | null {
  if (!category) return null
  return meals.find((meal) => meal.category === category && isEditable(meal, today)) ?? null
}

const FRIENDLY_BY_CODE: Record<string, string> = {
  '42501': 'This record is locked. Past food records can’t be changed.',
  P0002: 'That meal is no longer available.',
  '23514': 'Check the quantity and values — they must be greater than zero.',
  '23503': 'One of these foods is no longer available.',
}

/** Known messages raised by our own database functions → wording for people. */
const KNOWN_MESSAGES: readonly [RegExp, string][] = [
  [/future date/i, 'Food can’t be logged for a future date.'],
  [
    /last \d+ days only/i,
    `Missing food can only be added for the last ${String(LATE_ENTRY_DAYS)} days.`,
  ],
  [/at least one food|Add at least one food/i, 'Add at least one food.'],
  [/at most \d+ foods|Too many foods/i, 'Too many foods in one meal. Save it in parts.'],
  [/no food to copy/i, 'This meal has no food to copy.'],
]

/**
 * User-facing error text. Never shows raw database messages (table names,
 * constraints, SQL); unknown failures get `fallback`, which names the action
 * ("Couldn’t add this food. Please try again.").
 */
export function friendlyError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch|network/i.test(error.message))
  ) {
    return 'Couldn’t reach the server. Check your connection and try again.'
  }
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (typeof message === 'string') {
      const known = KNOWN_MESSAGES.find(([pattern]) => pattern.test(message))
      if (known) return known[1]
    }
    if (typeof code === 'string' && code in FRIENDLY_BY_CODE) return FRIENDLY_BY_CODE[code] ?? ''
  }
  return fallback
}
