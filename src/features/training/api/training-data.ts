import { z } from 'zod'

import { fetchTargetsForDate } from '@/features/nutrition/api/targets'
import type { AppSupabaseClient } from '@/lib/supabase/client'

import { parseWorkoutPlan } from '../lib/training'
import type { TrainingInput } from '../schemas'
import type {
  CalorieRates,
  TrainingKind,
  TrainingPlan,
  TrainingRecord,
  TrainingWeek,
} from '../types'

/*
 * Workout/activity data access. Everything runs with the signed-in user's
 * session: RLS decides visibility, the record guard decides what may change,
 * and the database computes the stored calorie estimate. Only one week is
 * ever read at a time.
 */

const WORKOUT_SELECT =
  'id, workout_date, workout_type, custom_name, duration_minutes, estimated_calories, manual_calories, final_calories, is_locked, created_at'
const ACTIVITY_SELECT =
  'id, activity_date, activity_type, custom_name, duration_minutes, estimated_calories, manual_calories, final_calories, is_locked, created_at'

interface RecordRow {
  id: string
  custom_name: string | null
  duration_minutes: number
  estimated_calories: number
  manual_calories: number | null
  final_calories: number | null
  is_locked: boolean
  created_at: string
}

function toRecord(kind: TrainingKind, row: RecordRow, date: string, type: string): TrainingRecord {
  return {
    id: row.id,
    kind,
    date,
    type,
    name: row.custom_name,
    durationMinutes: row.duration_minutes,
    estimatedCalories: row.estimated_calories,
    manualCalories: row.manual_calories,
    finalCalories: row.final_calories ?? row.manual_calories ?? row.estimated_calories,
    isLocked: row.is_locked,
    createdAt: row.created_at,
  }
}

/** Non-deleted workouts and activities of one Monday–Sunday week, up to today. */
export async function fetchTrainingWeek(
  supabase: AppSupabaseClient,
  userId: string,
  week: { start: string; end: string },
  today: string,
): Promise<TrainingWeek> {
  const last = week.end < today ? week.end : today
  const [workouts, activities] = await Promise.all([
    supabase
      .from('workouts')
      .select(WORKOUT_SELECT)
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('workout_date', week.start)
      .lte('workout_date', last)
      .order('workout_date')
      .order('created_at'),
    supabase
      .from('activities')
      .select(ACTIVITY_SELECT)
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('activity_date', week.start)
      .lte('activity_date', last)
      .order('activity_date')
      .order('created_at'),
  ])
  if (workouts.error) throw workouts.error
  if (activities.error) throw activities.error
  return {
    start: week.start,
    end: week.end,
    workouts: workouts.data.map((row) =>
      toRecord('workout', row, row.workout_date, row.workout_type),
    ),
    activities: activities.data.map((row) =>
      toRecord('activity', row, row.activity_date, row.activity_type),
    ),
  }
}

/** Capacity and template of the recommendation covering `date` (none = no guidance). */
export async function fetchTrainingPlan(
  supabase: AppSupabaseClient,
  userId: string,
  date: string,
): Promise<TrainingPlan> {
  const { targets, cycle } = await fetchTargetsForDate(supabase, userId, date)
  return {
    capacity: targets?.workoutsPerWeek ?? cycle?.workout_days_per_week ?? null,
    cycle: cycle
      ? { periodStart: cycle.period_start, sessions: parseWorkoutPlan(cycle.workout_plan_json) }
      : null,
  }
}

const ratesSchema = z.object({
  workout: z.record(z.string(), z.number().nonnegative()),
  activity: z.record(z.string(), z.number().nonnegative()),
})

/** The configured estimate rates, for the live preview only. */
export async function fetchCalorieRates(supabase: AppSupabaseClient): Promise<CalorieRates> {
  const { data, error } = await supabase.rpc('training_calorie_rates')
  if (error) throw error
  return ratesSchema.parse(data)
}

/**
 * A new workout/activity for today, or a missing past day (late entry, locked
 * once created). Sends no estimate: the database computes and stores it.
 */
export async function logTraining(
  supabase: AppSupabaseClient,
  kind: TrainingKind,
  input: TrainingInput,
): Promise<string> {
  const args = {
    p_date: input.date,
    p_type: input.type,
    p_duration_minutes: input.durationMinutes,
    ...(input.name === null ? {} : { p_name: input.name }),
    ...(input.manualCalories === null ? {} : { p_manual_calories: input.manualCalories }),
  }
  const { data, error } =
    kind === 'workout'
      ? await supabase.rpc('log_workout', args)
      : await supabase.rpc('log_activity', args)
  if (error) throw error
  return data
}

/** Edits an editable record; the database recomputes the estimate if needed. */
export async function updateTraining(
  supabase: AppSupabaseClient,
  kind: TrainingKind,
  id: string,
  input: Omit<TrainingInput, 'date'>,
): Promise<void> {
  const common = {
    custom_name: input.name,
    duration_minutes: input.durationMinutes,
    manual_calories: input.manualCalories,
  }
  const { error } =
    kind === 'workout'
      ? await supabase
          .from('workouts')
          .update({ ...common, workout_type: input.type })
          .eq('id', id)
      : await supabase
          .from('activities')
          .update({ ...common, activity_type: input.type })
          .eq('id', id)
  if (error) throw error
}

/** Soft delete (spec §7). */
export async function deleteTraining(
  supabase: AppSupabaseClient,
  kind: TrainingKind,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from(kind === 'workout' ? 'workouts' : 'activities')
    .update({ is_deleted: true })
    .eq('id', id)
  if (error) throw error
}
