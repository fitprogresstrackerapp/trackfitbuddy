/** Shared nutrition types (Home and Food). */

export interface Tolerance {
  /** Higher-is-better nutrients: met when actual ≥ target × nutrient. */
  nutrient: number
  /** Calories: acceptable when target × lower ≤ actual ≤ target × upper. */
  calorieLower: number
  calorieUpper: number
}

/** The food and training targets that apply on a date. */
export interface DailyTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  workoutsPerWeek: number
  /** Only known when the date's target snapshot exists. */
  tolerance: Tolerance | null
  source: 'snapshot' | 'cycle'
}

export interface NutritionTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  mealCount: number
  itemCount: number
}
