import type { AppSupabaseClient } from '@/lib/supabase/client'
import { calendarWeekOf } from '@/lib/dates/local-date'

import type {
  BodyPeriodData,
  CycleInfo,
  GoalInfo,
  NutritionPeriodData,
  Period,
  SnapshotInfo,
  StepsDay,
  TrainingPeriodData,
} from '../types'

/*
 * Progress data access. Every query runs with the signed-in session, so RLS
 * is the security boundary; the explicit user_id filter only narrows what an
 * admin/manager session could otherwise also read. Every query is bounded by
 * the period and selects only the columns Progress needs; soft-deleted
 * records are excluded, locked ones included.
 */

const CYCLE_COLUMNS =
  'id, status, period_start, period_end, review_deadline, goal_id, workout_days_per_week, final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g'

const SNAPSHOT_COLUMNS =
  'target_date, calories, protein_g, carbs_g, fat_g, fiber_g, workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance'

interface CycleRow {
  id: string
  status: CycleInfo['status'] | 'REPLACED'
  period_start: string
  period_end: string | null
  review_deadline: string
  goal_id: string | null
  workout_days_per_week: number
  final_calories: number
  final_protein_g: number
  final_carbs_g: number
  final_fat_g: number
  final_fiber_g: number
}

function toCycle(row: CycleRow): CycleInfo | null {
  if (row.status === 'REPLACED') return null
  return {
    id: row.id,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    reviewDeadline: row.review_deadline,
    goalId: row.goal_id,
    workout_days_per_week: row.workout_days_per_week,
    final_calories: row.final_calories,
    final_protein_g: row.final_protein_g,
    final_carbs_g: row.final_carbs_g,
    final_fat_g: row.final_fat_g,
    final_fiber_g: row.final_fiber_g,
  }
}

/** Recommendation cycles overlapping the period (replaced cycles never count). */
async function fetchCycles(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<CycleInfo[]> {
  const { data, error } = await supabase
    .from('recommendation_cycles')
    .select(CYCLE_COLUMNS)
    .eq('user_id', userId)
    .neq('status', 'REPLACED')
    .lte('period_start', period.end)
    .or(`period_end.is.null,period_end.gte.${period.start}`)
    .order('period_start')
  if (error) throw error
  return data.flatMap((row) => {
    const cycle = toCycle(row)
    return cycle ? [cycle] : []
  })
}

async function fetchSnapshots(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<SnapshotInfo[]> {
  const { data, error } = await supabase
    .from('daily_target_snapshots')
    .select(SNAPSHOT_COLUMNS)
    .eq('user_id', userId)
    .gte('target_date', period.start)
    .lte('target_date', period.end)
    .order('target_date')
  if (error) throw error
  return data
}

/** Per-day totals (server-side aggregate of snapshots) and the targets in force. */
export async function fetchNutritionPeriod(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<NutritionPeriodData> {
  const [days, snapshots, cycles] = await Promise.all([
    supabase.rpc('daily_nutrition', { p_start: period.start, p_end: period.end }),
    fetchSnapshots(supabase, userId, period),
    fetchCycles(supabase, userId, period),
  ])
  if (days.error) throw days.error
  return {
    days: days.data.map((day) => ({
      date: day.nutrition_date,
      calories: day.calories,
      proteinG: day.protein_g,
      carbsG: day.carbs_g,
      fatG: day.fat_g,
      fiberG: day.fiber_g,
      itemCount: day.item_count,
    })),
    snapshots,
    cycles,
  }
}

/**
 * Workouts and activities for the period, widened to whole Monday–Sunday weeks
 * so the first week's count is complete. Only date, duration and the stored
 * calorie value are read.
 */
export async function fetchTrainingPeriod(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<TrainingPeriodData> {
  const fetched = { start: calendarWeekOf(period.start).start, end: period.end }
  const [workouts, activities, snapshots, cycles] = await Promise.all([
    supabase
      .from('workouts')
      .select('workout_date, duration_minutes, final_calories, estimated_calories, manual_calories')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('workout_date', fetched.start)
      .lte('workout_date', fetched.end)
      .order('workout_date'),
    supabase
      .from('activities')
      .select(
        'activity_date, duration_minutes, final_calories, estimated_calories, manual_calories',
      )
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('activity_date', fetched.start)
      .lte('activity_date', fetched.end)
      .order('activity_date'),
    fetchSnapshots(supabase, userId, fetched),
    fetchCycles(supabase, userId, fetched),
  ])
  if (workouts.error) throw workouts.error
  if (activities.error) throw activities.error
  return {
    fetched,
    workouts: workouts.data.map((row) => ({
      date: row.workout_date,
      durationMinutes: row.duration_minutes,
      calories: row.final_calories ?? row.manual_calories ?? row.estimated_calories,
    })),
    activities: activities.data.map((row) => ({
      date: row.activity_date,
      durationMinutes: row.duration_minutes,
      calories: row.final_calories ?? row.manual_calories ?? row.estimated_calories,
    })),
    snapshots,
    cycles,
  }
}

/** Weight measurements (manual and InBody) and InBody body composition. */
export async function fetchBodyPeriod(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<BodyPeriodData> {
  const [weights, composition] = await Promise.all([
    supabase
      .from('weight_measurements')
      .select('measurement_date, weight_kg, source, created_at')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('measurement_date', period.start)
      .lte('measurement_date', period.end)
      .order('measurement_date'),
    supabase
      .from('inbody_metrics')
      .select('body_fat_percent, muscle_mass_kg, inbody_reports!inner(report_date, is_deleted)')
      .eq('user_id', userId)
      .eq('inbody_reports.is_deleted', false)
      .gte('inbody_reports.report_date', period.start)
      .lte('inbody_reports.report_date', period.end),
  ])
  if (weights.error) throw weights.error
  if (composition.error) throw composition.error
  return {
    weights: weights.data.map((row) => ({
      date: row.measurement_date,
      weightKg: row.weight_kg,
      source: row.source,
      createdAt: row.created_at,
    })),
    composition: composition.data
      .map((row) => ({
        date: row.inbody_reports.report_date,
        bodyFatPercent: row.body_fat_percent,
        muscleMassKg: row.muscle_mass_kg,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** Active step values (latest valid entry per day). No entry = no data. */
export async function fetchStepsPeriod(
  supabase: AppSupabaseClient,
  userId: string,
  period: Period,
): Promise<StepsDay[]> {
  const { data, error } = await supabase
    .from('daily_steps')
    .select('entry_date, steps')
    .eq('user_id', userId)
    .gte('entry_date', period.start)
    .lte('entry_date', period.end)
    .order('entry_date')
  if (error) throw error
  return data.flatMap((row) =>
    row.entry_date !== null && row.steps !== null
      ? [{ date: row.entry_date, steps: row.steps }]
      : [],
  )
}

export interface CurrentPlan {
  /** The cycle covering today (in review or active); `null` = no recommendation. */
  cycle: CycleInfo | null
  /** Goals locked to that cycle. */
  cycleGoal: GoalInfo | null
  /** The profile's currently active goal (may differ: it applies to the next cycle). */
  activeGoal: GoalInfo | null
}

interface GoalRow {
  long_term_goal: string
  description: string | null
  effective_from: string
  goal_focuses: { focus_type: string; priority: number }[]
}

function toGoal(row: GoalRow): GoalInfo {
  return {
    longTermGoal: row.long_term_goal,
    description: row.description,
    effectiveFrom: row.effective_from,
    focuses: [...row.goal_focuses]
      .sort((a, b) => a.priority - b.priority)
      .map((focus) => focus.focus_type),
  }
}

const GOAL_COLUMNS =
  'long_term_goal, description, effective_from, goal_focuses(focus_type, priority)'

export async function fetchCurrentPlan(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<CurrentPlan> {
  const [cycles, activeGoal] = await Promise.all([
    fetchCycles(supabase, userId, { start: today, end: today }),
    supabase
      .from('goals')
      .select(GOAL_COLUMNS)
      .eq('user_id', userId)
      .eq('is_active', true)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (activeGoal.error) throw activeGoal.error
  const cycle = cycles.at(-1) ?? null

  let cycleGoal: GoalInfo | null = null
  if (cycle?.goalId) {
    const { data, error } = await supabase
      .from('goals')
      .select(GOAL_COLUMNS)
      .eq('id', cycle.goalId)
      .maybeSingle()
    if (error) throw error
    cycleGoal = data ? toGoal(data) : null
  }
  return { cycle, cycleGoal, activeGoal: activeGoal.data ? toGoal(activeGoal.data) : null }
}
