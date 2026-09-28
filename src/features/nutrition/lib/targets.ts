import type { DailyTargets } from '../types'

/*
 * Target selection (spec §26), shared by Home, Food and Progress: a date uses
 * its own target snapshot; if none was materialised, the final targets of the
 * recommendation cycle covering it (tolerance unknown). Never invented.
 */

export interface TargetSnapshotRow {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  workouts_per_week: number
  nutrition_tolerance: number
  calorie_lower_tolerance: number
  calorie_upper_tolerance: number
}

export interface TargetCycleRow {
  final_calories: number
  final_protein_g: number
  final_carbs_g: number
  final_fat_g: number
  final_fiber_g: number
  workout_days_per_week: number
}

export function resolveTargets(
  snapshot: TargetSnapshotRow | null,
  cycle: TargetCycleRow | null,
): DailyTargets | null {
  if (snapshot) {
    return {
      calories: snapshot.calories,
      proteinG: snapshot.protein_g,
      carbsG: snapshot.carbs_g,
      fatG: snapshot.fat_g,
      fiberG: snapshot.fiber_g,
      workoutsPerWeek: snapshot.workouts_per_week,
      tolerance: {
        nutrient: snapshot.nutrition_tolerance,
        calorieLower: snapshot.calorie_lower_tolerance,
        calorieUpper: snapshot.calorie_upper_tolerance,
      },
      source: 'snapshot',
    }
  }
  if (cycle) {
    return {
      calories: cycle.final_calories,
      proteinG: cycle.final_protein_g,
      carbsG: cycle.final_carbs_g,
      fatG: cycle.final_fat_g,
      fiberG: cycle.final_fiber_g,
      workoutsPerWeek: cycle.workout_days_per_week,
      tolerance: null,
      source: 'cycle',
    }
  }
  return null
}
