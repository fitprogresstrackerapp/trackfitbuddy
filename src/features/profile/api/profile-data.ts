import type { Gender } from '@/features/auth/types'
import { addDays } from '@/lib/dates/local-date'
import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database, Json } from '@/types/database'

import type {
  GoalInput,
  LifestyleInput,
  ReviewInput,
  StepsEntryInput,
  WeightEntryInput,
} from '../schemas'

/*
 * Profile data access. Everything runs as the signed-in user: RLS decides
 * visibility and the record guard decides what may change. Measurements and
 * steps are always added as new records (history is kept); only today's own
 * manual records can be corrected or removed.
 */

type ActivityLevel = Database['public']['Enums']['activity_level']
type MeasurementSource = Database['public']['Enums']['measurement_source']

export interface ProfileDetails {
  name: string | null
  dateOfBirth: string | null
  gender: Gender | null
  heightCm: number | null
  activityLevel: ActivityLevel | null
  job: string | null
  hobbies: string | null
  /** Preference for the NEXT recommendation; the current cycle keeps its own. */
  workoutDaysPerWeek: number | null
  phone: string
  timezone: string
}

export async function fetchProfileDetails(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<ProfileDetails> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'name, date_of_birth, gender, height_cm, activity_level, job, hobbies, workout_days_per_week, phone, timezone',
    )
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    name: data.name,
    dateOfBirth: data.date_of_birth,
    gender: data.gender,
    heightCm: data.height_cm,
    activityLevel: data.activity_level,
    job: data.job,
    hobbies: data.hobbies,
    workoutDaysPerWeek: data.workout_days_per_week,
    phone: data.phone,
    timezone: data.timezone,
  }
}

export async function updatePersonal(
  supabase: AppSupabaseClient,
  userId: string,
  input: { name: string; dateOfBirth: string; gender: Gender },
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ name: input.name, date_of_birth: input.dateOfBirth, gender: input.gender })
    .eq('id', userId)
  if (error) throw error
}

export async function updateHeight(
  supabase: AppSupabaseClient,
  userId: string,
  heightCm: number,
): Promise<void> {
  const { error } = await supabase.from('profiles').update({ height_cm: heightCm }).eq('id', userId)
  if (error) throw error
}

export async function updateLifestyle(
  supabase: AppSupabaseClient,
  userId: string,
  input: LifestyleInput,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ activity_level: input.activityLevel, job: input.job, hobbies: input.hobbies })
    .eq('id', userId)
  if (error) throw error
}

/** Stored on the profile for the next recommendation (never on the current cycle). */
export async function updateCapacity(
  supabase: AppSupabaseClient,
  userId: string,
  workoutDaysPerWeek: number,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ workout_days_per_week: workoutDaysPerWeek })
    .eq('id', userId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export interface WeightEntry {
  id: string
  date: string
  weightKg: number
  source: MeasurementSource
  createdAt: string
}

export interface WeightData {
  /** The current weight (existing precedence: latest date, InBody wins on a date). */
  current: { date: string; weightKg: number; source: MeasurementSource; id: string } | null
  /** Recent measurements, newest first. */
  recent: WeightEntry[]
}

export async function fetchWeights(
  supabase: AppSupabaseClient,
  userId: string,
  limit = 10,
): Promise<WeightData> {
  const [current, recent] = await Promise.all([
    supabase
      .from('current_weights')
      .select('weight_measurement_id, measurement_date, weight_kg, source')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('weight_measurements')
      .select('id, measurement_date, weight_kg, source, created_at')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('measurement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  if (current.error) throw current.error
  if (recent.error) throw recent.error
  const row = current.data
  return {
    current:
      row?.weight_measurement_id && row.measurement_date && row.weight_kg !== null && row.source
        ? {
            id: row.weight_measurement_id,
            date: row.measurement_date,
            weightKg: row.weight_kg,
            source: row.source,
          }
        : null,
    recent: recent.data.map((entry) => ({
      id: entry.id,
      date: entry.measurement_date,
      weightKg: entry.weight_kg,
      source: entry.source,
      createdAt: entry.created_at,
    })),
  }
}

/** A new manual measurement (today, or a missing past day — then locked). */
export async function logWeight(
  supabase: AppSupabaseClient,
  input: WeightEntryInput,
): Promise<void> {
  const { error } = await supabase.rpc('log_weight', {
    p_date: input.date,
    p_weight_kg: input.weightKg,
  })
  if (error) throw error
}

export async function updateWeight(
  supabase: AppSupabaseClient,
  id: string,
  weightKg: number,
): Promise<void> {
  const { error } = await supabase
    .from('weight_measurements')
    .update({ weight_kg: weightKg })
    .eq('id', id)
  if (error) throw error
}

export async function deleteWeight(supabase: AppSupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('weight_measurements')
    .update({ is_deleted: true })
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface StepEntry {
  id: string
  date: string
  steps: number
  isActive: boolean
  createdAt: string
}

/** Every non-deleted entry (active and superseded) for the last `days` days. */
export async function fetchRecentSteps(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
  days = 14,
): Promise<StepEntry[]> {
  const { data, error } = await supabase
    .from('steps_entries')
    .select('id, entry_date, steps, is_active, created_at')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .gte('entry_date', addDays(today, -(days - 1)))
    .lte('entry_date', today)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((entry) => ({
    id: entry.id,
    date: entry.entry_date,
    steps: entry.steps,
    isActive: entry.is_active,
    createdAt: entry.created_at,
  }))
}

/** A new entry; it becomes the day's active value. Earlier entries are kept. */
export async function logSteps(supabase: AppSupabaseClient, input: StepsEntryInput): Promise<void> {
  const { error } = await supabase.rpc('log_steps', { p_date: input.date, p_steps: input.steps })
  if (error) throw error
}

/** Removes one of today's entries; the previous entry becomes active again. */
export async function deleteSteps(supabase: AppSupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('steps_entries').update({ is_deleted: true }).eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// InBody
// ---------------------------------------------------------------------------

export interface InbodyReport {
  id: string
  date: string
  status: Database['public']['Enums']['inbody_extraction_status']
  filePath: string
  fileType: string
  metrics: {
    weightKg: number | null
    bodyFatPercent: number | null
    muscleMassKg: number | null
    bmi: number | null
    bmrKcal: number | null
  } | null
}

export async function fetchInbodyReports(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<InbodyReport[]> {
  const { data, error } = await supabase
    .from('inbody_reports')
    .select(
      'id, report_date, extraction_status, file_path, file_type, inbody_metrics(weight_kg, body_fat_percent, muscle_mass_kg, bmi, bmr_kcal)',
    )
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('report_date', { ascending: false })
    .limit(12)
  if (error) throw error
  return data.map((row) => {
    const metrics = row.inbody_metrics[0]
    return {
      id: row.id,
      date: row.report_date,
      status: row.extraction_status,
      filePath: row.file_path,
      fileType: row.file_type,
      metrics: metrics
        ? {
            weightKg: metrics.weight_kg,
            bodyFatPercent: metrics.body_fat_percent,
            muscleMassKg: metrics.muscle_mass_kg,
            bmi: metrics.bmi,
            bmrKcal: metrics.bmr_kcal,
          }
        : null,
    }
  })
}

export const INBODY_BUCKET = 'inbody-reports'
export const INBODY_MAX_BYTES = 10 * 1024 * 1024
export const INBODY_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

/**
 * Stores the original report in the user's private folder and records it for
 * later extraction (status PENDING). Nothing is read from the file here.
 */
export async function uploadInbodyReport(
  supabase: AppSupabaseClient,
  userId: string,
  input: { date: string; file: File },
): Promise<void> {
  const path = `${userId}/${input.date}-${crypto.randomUUID()}.${EXTENSIONS[input.file.type] ?? 'bin'}`
  const upload = await supabase.storage
    .from(INBODY_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (upload.error) throw upload.error
  const { error } = await supabase.from('inbody_reports').insert({
    user_id: userId,
    report_date: input.date,
    file_path: path,
    file_type: input.file.type,
  })
  if (error) throw error
}

/** A short-lived link to the user's own report file. */
export async function inbodyReportUrl(supabase: AppSupabaseClient, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(INBODY_BUCKET).createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Goals and the current recommendation
// ---------------------------------------------------------------------------

export interface GoalDetails {
  longTermGoal: string
  description: string | null
  effectiveFrom: string
  focuses: string[]
}

interface GoalRow {
  long_term_goal: string
  description: string | null
  effective_from: string
  goal_focuses: { focus_type: string; priority: number }[]
}

const GOAL_COLUMNS =
  'long_term_goal, description, effective_from, goal_focuses(focus_type, priority)'

function toGoal(row: GoalRow): GoalDetails {
  return {
    longTermGoal: row.long_term_goal,
    description: row.description,
    effectiveFrom: row.effective_from,
    focuses: [...row.goal_focuses]
      .sort((a, b) => a.priority - b.priority)
      .map((focus) => focus.focus_type),
  }
}

export interface Targets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

export interface Recommendation {
  id: string
  status: 'IN_REVIEW' | 'LOCKED'
  periodStart: string
  periodEnd: string | null
  reviewDeadline: string
  capacity: number
  recommended: Targets
  final: Targets
  /** Current template session names (may be edited during review). */
  sessions: string[]
  /** The AI's original session names, when the output carries them. */
  originalSessions: string[] | null
  summary: string | null
  goal: GoalDetails | null
}

export interface PlanData {
  /** The active profile goal (applies from the next recommendation). */
  activeGoal: GoalDetails | null
  /** The recommendation covering today, if any. */
  recommendation: Recommendation | null
}

function sessionNames(value: Json | undefined): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sessions = (value as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return null
  return sessions.flatMap((session: unknown) => {
    if (typeof session === 'string') return [session]
    if (session && typeof session === 'object' && 'name' in session) {
      const name = session.name
      return typeof name === 'string' ? [name] : []
    }
    return []
  })
}

function outputField(output: Json, key: string): Json | undefined {
  return output && typeof output === 'object' && !Array.isArray(output) ? output[key] : undefined
}

export async function fetchPlan(
  supabase: AppSupabaseClient,
  userId: string,
  today: string,
): Promise<PlanData> {
  const [goal, cycle] = await Promise.all([
    supabase
      .from('goals')
      .select(GOAL_COLUMNS)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('recommendation_cycles')
      .select(
        'id, status, period_start, period_end, review_deadline, workout_days_per_week, goal_id, recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g, final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g, workout_plan_json, parsed_output_json',
      )
      .eq('user_id', userId)
      .neq('status', 'REPLACED')
      .lte('period_start', today)
      .or(`period_end.is.null,period_end.gte.${today}`)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (goal.error) throw goal.error
  if (cycle.error) throw cycle.error

  let recommendation: Recommendation | null = null
  const row = cycle.data
  if (row && row.status !== 'REPLACED') {
    let cycleGoal: GoalDetails | null = null
    if (row.goal_id) {
      const locked = await supabase
        .from('goals')
        .select(GOAL_COLUMNS)
        .eq('id', row.goal_id)
        .maybeSingle()
      if (locked.error) throw locked.error
      cycleGoal = locked.data ? toGoal(locked.data) : null
    }
    const summary = outputField(row.parsed_output_json, 'summary')
    recommendation = {
      id: row.id,
      status: row.status,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      reviewDeadline: row.review_deadline,
      capacity: row.workout_days_per_week,
      recommended: {
        calories: row.recommended_calories,
        proteinG: row.recommended_protein_g,
        carbsG: row.recommended_carbs_g,
        fatG: row.recommended_fat_g,
        fiberG: row.recommended_fiber_g,
      },
      final: {
        calories: row.final_calories,
        proteinG: row.final_protein_g,
        carbsG: row.final_carbs_g,
        fatG: row.final_fat_g,
        fiberG: row.final_fiber_g,
      },
      sessions: sessionNames(row.workout_plan_json) ?? [],
      originalSessions: sessionNames(outputField(row.parsed_output_json, 'workout_plan')),
      summary: typeof summary === 'string' ? summary : null,
      goal: cycleGoal,
    }
  }
  return { activeGoal: goal.data ? toGoal(goal.data) : null, recommendation }
}

/** Edits the active goal, or starts a new version if a cycle already uses it. */
export async function saveGoal(supabase: AppSupabaseClient, input: GoalInput): Promise<void> {
  const { error } = await supabase.rpc('set_goal', {
    p_long_term_goal: input.longTermGoal,
    p_focuses: input.focuses,
    ...(input.objective === null ? {} : { p_description: input.objective }),
  })
  if (error) throw error
}

/** Final targets and session names, during the review window only (server-enforced). */
export async function reviewRecommendation(
  supabase: AppSupabaseClient,
  cycleId: string,
  input: ReviewInput,
): Promise<void> {
  const { error } = await supabase.rpc('review_recommendation', {
    p_cycle_id: cycleId,
    p_calories: input.calories,
    p_protein_g: input.proteinG,
    p_carbs_g: input.carbsG,
    p_fat_g: input.fatG,
    p_fiber_g: input.fiberG,
    ...(input.sessions.length > 0 ? { p_sessions: input.sessions } : {}),
  })
  if (error) throw error
}

export async function acceptRecommendation(
  supabase: AppSupabaseClient,
  cycleId: string,
): Promise<void> {
  const { error } = await supabase.rpc('accept_recommendation', { p_cycle_id: cycleId })
  if (error) throw error
}
