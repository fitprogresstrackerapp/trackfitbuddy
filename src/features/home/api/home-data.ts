import { z } from 'zod'

import { calendarWeekOf } from '@/lib/dates/local-date'
import type { AppSupabaseClient } from '@/lib/supabase/client'

import { fetchTargetsForDate } from '@/features/nutrition/api/targets'
import { sumNutrition } from '@/features/nutrition/lib/nutrition'

import { countWorkoutDays } from '../lib/home-logic'
import type { CycleGoal, HomeNutrition, HomePlan, HomeTraining, PlanCycle } from '../types'

/*
 * Home data access. Every query runs with the signed-in user's session, so
 * RLS decides visibility; the explicit user_id filter only narrows what an
 * admin/manager session would otherwise also be allowed to read. Only today's
 * (or this week's) rows are requested — never history.
 */

/**
 * Workout template sessions from the recommendation's final plan. The plan
 * JSON contract belongs to the recommendation engine (later phase); this reads
 * only `sessions[].name` (or plain strings) and ignores anything else.
 */
const workoutPlanSchema = z.object({
  sessions: z.array(z.union([z.string(), z.looseObject({ name: z.string() })])),
})

function sessionNames(plan: unknown): string[] {
  const parsed = workoutPlanSchema.safeParse(plan)
  if (!parsed.success) return []
  return parsed.data.sessions.map((session) =>
    typeof session === 'string' ? session : session.name,
  )
}

/** Today's targets, the recommendation cycle covering today, and that cycle's goals. */
export async function fetchHomePlan(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<HomePlan> {
  const { targets, cycle: cycleRow } = await fetchTargetsForDate(supabase, userId, today)

  const cycle: PlanCycle | null =
    cycleRow && cycleRow.status !== 'REPLACED'
      ? {
          id: cycleRow.id,
          status: cycleRow.status,
          periodStart: cycleRow.period_start,
          reviewDeadline: cycleRow.review_deadline,
          workoutDaysPerWeek: cycleRow.workout_days_per_week,
          sessions: sessionNames(cycleRow.workout_plan_json),
        }
      : null

  let goal: CycleGoal | null = null
  if (cycleRow?.goal_id) {
    const { data, error } = await supabase
      .from('goals')
      .select('long_term_goal, description, goal_focuses(focus_type, priority)')
      .eq('id', cycleRow.goal_id)
      .maybeSingle()
    if (error) throw error
    if (data) {
      goal = {
        longTermGoal: data.long_term_goal,
        description: data.description,
        focuses: [...data.goal_focuses]
          .sort((a, b) => a.priority - b.priority)
          .map((focus) => focus.focus_type),
      }
    }
  }

  return { targets, cycle, goal }
}

/** Today's intake from logged meal-item snapshots (never the current food master). */
export async function fetchHomeNutrition(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<HomeNutrition> {
  const { data, error } = await supabase
    .from('meals')
    .select(
      'id, meal_items(snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g)',
    )
    .eq('user_id', userId)
    .eq('meal_date', today)
    .eq('is_deleted', false)
    .eq('meal_items.is_deleted', false)

  if (error) throw error
  return { totals: sumNutrition(data) }
}

/** Today's steps and activities, and this Monday–Sunday week's workouts. */
export async function fetchHomeTraining(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<HomeTraining> {
  const week = calendarWeekOf(today)
  const [stepsResult, workoutsResult, activitiesResult] = await Promise.all([
    supabase
      .from('daily_steps')
      .select('steps')
      .eq('user_id', userId)
      .eq('entry_date', today)
      .maybeSingle(),
    supabase
      .from('workouts')
      .select('id, workout_date, workout_type, custom_name, duration_minutes, final_calories')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('workout_date', week.start)
      .lte('workout_date', week.end)
      .order('created_at'),
    supabase
      .from('activities')
      .select('id, activity_type, custom_name, duration_minutes, final_calories')
      .eq('user_id', userId)
      .eq('activity_date', today)
      .eq('is_deleted', false)
      .order('created_at'),
  ])

  if (stepsResult.error) throw stepsResult.error
  if (workoutsResult.error) throw workoutsResult.error
  if (activitiesResult.error) throw activitiesResult.error

  const workouts = workoutsResult.data
  return {
    steps: stepsResult.data?.steps ?? null,
    workoutsToday: workouts
      .filter((workout) => workout.workout_date === today)
      .map((workout) => ({
        id: workout.id,
        type: workout.workout_type,
        customName: workout.custom_name,
        durationMinutes: workout.duration_minutes,
        calories: workout.final_calories,
      })),
    workoutDaysThisWeek: countWorkoutDays(
      workouts.map((workout) => workout.workout_date),
      today,
    ),
    week,
    activitiesToday: activitiesResult.data.map((activity) => ({
      id: activity.id,
      type: activity.activity_type,
      customName: activity.custom_name,
      durationMinutes: activity.duration_minutes,
      calories: activity.final_calories,
    })),
  }
}
