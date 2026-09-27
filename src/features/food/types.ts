import type { MealItemSnapshot } from '@/features/nutrition/lib/nutrition'
import type { Database } from '@/types/database'

export type MealCategory = Database['public']['Enums']['meal_category']
export type ReviewStatus = Database['public']['Enums']['food_review_status']

/**
 * A food the user can pick: a shared (curated) food, or one of the user's own
 * submissions still waiting for review. Values are per serving.
 */
export interface FoodOption {
  source: 'FOOD' | 'SUBMISSION'
  id: string
  name: string
  servingQuantity: number
  servingUnit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  isApproximate: boolean
  reviewStatus: ReviewStatus | null
  useCount: number
  lastUsed: string | null
}

export interface LoggedItem extends MealItemSnapshot {
  id: string
  foodName: string
  quantity: number
  unit: string
  isUserFood: boolean
  /** Shared food flagged as approximate (unknown when the food is no longer listed). */
  isApproximate: boolean
}

export interface LoggedMeal {
  id: string
  date: string
  category: MealCategory | null
  name: string | null
  isLocked: boolean
  copiedFromMealId: string | null
  createdAt: string
  /** Items only — the database trigger computed every value. */
  meal_items: LoggedItem[]
}

/** A food + quantity waiting to be saved. Never carries nutrition to the server. */
export interface DraftItem {
  key: string
  food: FoodOption
  quantity: number
}

export interface FoodSubmission {
  id: string
  name: string
  servingQuantity: number
  servingUnit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  status: ReviewStatus
  createdAt: string
}
