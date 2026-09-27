import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

import type { DailyTargets } from '../types'

type CycleRow = Pick<
  Database['public']['Tables']['recommendation_cycles']['Row'],
  | 'id'
  | 'status'
  | 'period_start'
  | 'review_deadline'
  | 'workout_days_per_week'
  | 'workout_plan_json'
  | 'goal_id'
>

export interface DayTargets {
  targets: DailyTargets | null
  /** The recommendation cycle covering the date, if any. */
  cycle: CycleRow | null
}

/**
 * The targets that apply on `date` (spec §26): the date's target snapshot; if
 * none has been materialised yet, the final targets of the recommendation
 * cycle covering the date (without tolerance). Never invented.
 * Runs as the signed-in user (RLS).
 */
export async function fetchTargetsForDate(
  supabase: AppSupabaseClient,
  userId: string,
  date: string,
): Promise<DayTargets> {
  const [snapshotResult, cycleResult] = await Promise.all([
    supabase
      .from('daily_target_snapshots')
      .select(
        'calories, protein_g, carbs_g, fat_g, fiber_g, workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance',
      )
      .eq('user_id', userId)
      .eq('target_date', date)
      .maybeSingle(),
    supabase
      .from('recommendation_cycles')
      .select(
        'id, status, period_start, review_deadline, workout_days_per_week, workout_plan_json, goal_id, final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g',
      )
      .eq('user_id', userId)
      .neq('status', 'REPLACED')
      .lte('period_start', date)
      .or(`period_end.is.null,period_end.gte.${date}`)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (snapshotResult.error) throw snapshotResult.error
  if (cycleResult.error) throw cycleResult.error

  const snapshot = snapshotResult.data
  const cycle = cycleResult.data

  if (snapshot) {
    return {
      cycle,
      targets: {
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
      },
    }
  }

  if (cycle) {
    return {
      cycle,
      targets: {
        calories: cycle.final_calories,
        proteinG: cycle.final_protein_g,
        carbsG: cycle.final_carbs_g,
        fatG: cycle.final_fat_g,
        fiberG: cycle.final_fiber_g,
        workoutsPerWeek: cycle.workout_days_per_week,
        tolerance: null,
        source: 'cycle',
      },
    }
  }

  return { targets: null, cycle: null }
}
