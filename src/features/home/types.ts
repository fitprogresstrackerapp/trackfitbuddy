import type { Database } from '@/types/database'

export type CycleStatus = Database['public']['Enums']['recommendation_cycle_status']

export interface Tolerance {
  /** Higher-is-better nutrients: met when actual ≥ target × nutrient. */
  nutrient: number
  /** Calories: acceptable when target × lower ≤ actual ≤ target × upper. */
  calorieLower: number
  calorieUpper: number
}

/** The food and training targets that apply today. */
export interface DailyTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  workoutsPerWeek: number
  /** Only known when today's target snapshot exists. */
  tolerance: Tolerance | null
  source: 'snapshot' | 'cycle'
}

export interface PlanCycle {
  id: string
  status: Exclude<CycleStatus, 'REPLACED'>
  periodStart: string
  reviewDeadline: string
  workoutDaysPerWeek: number
  /** Session names from the recommended workout template, in order. */
  sessions: string[]
}

export interface CycleGoal {
  longTermGoal: string
  description: string | null
  /** Short-term focus values, highest priority first. */
  focuses: string[]
}

export interface HomePlan {
  targets: DailyTargets | null
  cycle: PlanCycle | null
  goal: CycleGoal | null
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

export interface HomeNutrition {
  /** `null` = nothing logged today (not zero intake). */
  totals: NutritionTotals | null
}

export interface TrainingEntry {
  id: string
  type: string
  customName: string | null
  durationMinutes: number
  calories: number | null
}

export interface HomeTraining {
  /** Active step value for today; `null` = no entry (not zero steps). */
  steps: number | null
  workoutsToday: TrainingEntry[]
  /** Distinct days with a valid workout in the current Monday–Sunday week, up to today. */
  workoutDaysThisWeek: number
  week: { start: string; end: string }
  activitiesToday: TrainingEntry[]
}
