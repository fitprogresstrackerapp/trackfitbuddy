import type { NutritionTotals, Tolerance } from '../types.ts'

/*
 * Nutrition rules shared by Home and Food. Pure functions over rows the
 * database has already filtered (soft deletion) and valued (snapshots).
 */

export interface MealItemSnapshot {
  snapshot_calories: number
  snapshot_protein_g: number
  snapshot_carbs_g: number
  snapshot_fat_g: number
  snapshot_fiber_g: number
}

/**
 * Sums logged meal-item snapshots. Returns `null` when nothing is logged —
 * missing data is never zero intake (spec §28, §68). A logged item whose
 * values are genuinely 0 still counts as logged.
 */
export function sumNutrition(
  meals: readonly { meal_items: readonly MealItemSnapshot[] }[],
): NutritionTotals | null {
  const items = meals.flatMap((meal) => meal.meal_items)
  if (items.length === 0) return null

  const total = (pick: (item: MealItemSnapshot) => number) =>
    Math.round(items.reduce((sum, item) => sum + pick(item), 0) * 100) / 100

  return {
    calories: total((item) => item.snapshot_calories),
    proteinG: total((item) => item.snapshot_protein_g),
    carbsG: total((item) => item.snapshot_carbs_g),
    fatG: total((item) => item.snapshot_fat_g),
    fiberG: total((item) => item.snapshot_fiber_g),
    mealCount: meals.filter((meal) => meal.meal_items.length > 0).length,
    itemCount: items.length,
  }
}

export type NutrientStatus = 'no-data' | 'met' | 'below'
export type CalorieStatus = 'no-data' | 'below' | 'within' | 'above'

/**
 * Higher-is-better nutrients (spec §27): met when actual ≥ target × tolerance.
 * `null` when the tolerance in force is unknown (no snapshot for the date).
 */
export function evaluateNutrient(
  actual: number | null,
  target: number,
  tolerance: Tolerance | null,
): NutrientStatus | null {
  if (actual === null) return 'no-data'
  if (!tolerance) return null
  return actual >= target * tolerance.nutrient ? 'met' : 'below'
}

/**
 * Calories are a range, not "more is better" (spec §27): acceptable between
 * target × lower and target × upper.
 */
export function evaluateCalories(
  actual: number | null,
  target: number,
  tolerance: Tolerance | null,
): CalorieStatus | null {
  if (actual === null) return 'no-data'
  if (!tolerance) return null
  if (actual < target * tolerance.calorieLower) return 'below'
  if (actual > target * tolerance.calorieUpper) return 'above'
  return 'within'
}

/**
 * Food intake against the daily food target. Workout and activity expenditure
 * is deliberately NOT subtracted: the calorie target is a food target.
 */
export function calorieBalance(
  actual: number | null,
  target: number,
): { remaining: number } | null {
  if (actual === null) return null
  return { remaining: Math.round(target - actual) }
}
