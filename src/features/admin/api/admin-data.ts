import { FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js'

import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database, Json } from '@/types/database'

/*
 * Admin management data (spec §5–7, §63, §69, §78–79). Every call is a
 * server-side function that authorizes the caller itself:
 *   admins → all users; managers → only assigned users, read-only;
 *   anyone else → refused.
 * Account creation and PIN reset go through the admin-users Edge Function
 * (service role, bcrypt); no PIN or hash ever comes back.
 */

export type AppRole = Database['public']['Enums']['app_role']
export type AuditAction = Database['public']['Enums']['audit_action']
export type Gender = Database['public']['Enums']['gender']
export type ActivityLevel = Database['public']['Enums']['activity_level']
export type MealCategory = Database['public']['Enums']['meal_category']

export type RecommendationStatus = 'IN_REVIEW' | 'ACTIVE' | 'NONE'

export interface UserRow {
  userId: string
  name: string | null
  phone: string
  roles: AppRole[]
  isActive: boolean
  isProfileComplete: boolean
  missingFields: string[]
  recommendationStatus: RecommendationStatus
  lastActivity: string | null
  createdAt: string
}

export interface UserFilters {
  search: string
  role: AppRole | null
  active: boolean | null
  complete: boolean | null
}

export const USERS_PAGE_SIZE = 20

const toStatus = (value: string): RecommendationStatus =>
  value === 'IN_REVIEW' || value === 'ACTIVE' ? value : 'NONE'

export async function listUsers(
  supabase: AppSupabaseClient,
  filters: UserFilters,
  page: number,
): Promise<{ rows: UserRow[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_list_users', {
    ...(filters.search.trim() ? { p_search: filters.search.trim() } : {}),
    ...(filters.role ? { p_role: filters.role } : {}),
    ...(filters.active === null ? {} : { p_active: filters.active }),
    ...(filters.complete === null ? {} : { p_complete: filters.complete }),
    p_limit: USERS_PAGE_SIZE,
    p_offset: page * USERS_PAGE_SIZE,
  })
  if (error) throw error
  return {
    total: data[0]?.total_count ?? 0,
    rows: data.map((row) => ({
      userId: row.user_id,
      name: row.name,
      phone: row.phone,
      roles: row.roles,
      isActive: row.is_active,
      isProfileComplete: row.is_profile_complete,
      missingFields: row.missing_fields,
      recommendationStatus: toStatus(row.recommendation_status),
      lastActivity: row.last_activity,
      createdAt: row.created_at,
    })),
  }
}

export interface UserAccount {
  userId: string
  name: string | null
  phone: string
  roles: AppRole[]
  isActive: boolean
  createdAt: string
  /** Version used for concurrency-checked profile corrections. */
  updatedAt: string
  deactivatedAt: string | null
  deactivatedByName: string | null
  timezone: string
  dateOfBirth: string | null
  gender: Gender | null
  heightCm: number | null
  activityLevel: ActivityLevel | null
  job: string | null
  hobbies: string | null
  workoutDaysPerWeek: number | null
  missingFields: string[]
  recommendationStatus: RecommendationStatus
  lastActivity: string | null
  /** The server's answer: may this admin change this account? */
  canAdminister: boolean
}

export async function fetchUserAccount(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<UserAccount | null> {
  const { data, error } = await supabase
    .rpc('admin_user_account', { p_user_id: userId })
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    userId: data.user_id,
    name: data.name,
    phone: data.phone,
    roles: data.roles,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    deactivatedAt: data.deactivated_at,
    deactivatedByName: data.deactivated_by_name,
    timezone: data.timezone,
    dateOfBirth: data.date_of_birth,
    gender: data.gender,
    heightCm: data.height_cm,
    activityLevel: data.activity_level,
    job: data.job,
    hobbies: data.hobbies,
    workoutDaysPerWeek: data.workout_days_per_week,
    missingFields: data.missing_fields,
    recommendationStatus: toStatus(data.recommendation_status),
    lastActivity: data.last_activity,
    canAdminister: data.can_administer,
  }
}

// --- Records of one day (read through the existing RLS: admins, managers of
// --- the user) ---------------------------------------------------------------

export interface MealItemRecord {
  id: string
  foodItemId: string | null
  name: string
  quantity: number
  unit: string
  calories: number
  proteinG: number
  updatedAt: string
}

export interface MealRecord {
  id: string
  category: MealCategory | null
  isLocked: boolean
  updatedAt: string
  items: MealItemRecord[]
}

export interface TrainingRecord {
  id: string
  kind: 'workout' | 'activity'
  type: string
  name: string | null
  durationMinutes: number
  estimatedCalories: number
  manualCalories: number | null
  finalCalories: number
  isLocked: boolean
  updatedAt: string
}

export interface StepsRecord {
  id: string
  steps: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface DayRecords {
  meals: MealRecord[]
  workouts: TrainingRecord[]
  activities: TrainingRecord[]
  steps: StepsRecord[]
  totals: { calories: number; proteinG: number } | null
  target: { calories: number; proteinG: number; source: 'snapshot' | 'cycle' } | null
}

export async function fetchDayRecords(
  supabase: AppSupabaseClient,
  userId: string,
  date: string,
): Promise<DayRecords> {
  const [meals, workouts, activities, steps, totals, snapshot, cycle] = await Promise.all([
    supabase
      .from('meals')
      .select(
        'id, meal_category, is_locked, updated_at, meal_items(id, food_item_id, food_name_snapshot, quantity, unit, snapshot_calories, snapshot_protein_g, updated_at, is_deleted)',
      )
      .eq('user_id', userId)
      .eq('meal_date', date)
      .eq('is_deleted', false)
      .order('created_at'),
    supabase
      .from('workouts')
      .select(
        'id, workout_type, custom_name, duration_minutes, estimated_calories, manual_calories, final_calories, is_locked, updated_at',
      )
      .eq('user_id', userId)
      .eq('workout_date', date)
      .eq('is_deleted', false)
      .order('created_at'),
    supabase
      .from('activities')
      .select(
        'id, activity_type, custom_name, duration_minutes, estimated_calories, manual_calories, final_calories, is_locked, updated_at',
      )
      .eq('user_id', userId)
      .eq('activity_date', date)
      .eq('is_deleted', false)
      .order('created_at'),
    supabase
      .from('steps_entries')
      .select('id, steps, is_active, created_at, updated_at')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }),
    supabase.rpc('admin_daily_nutrition', { p_user_id: userId, p_start: date, p_end: date }),
    supabase
      .from('daily_target_snapshots')
      .select('calories, protein_g')
      .eq('user_id', userId)
      .eq('target_date', date)
      .maybeSingle(),
    supabase
      .from('recommendation_cycles')
      .select('final_calories, final_protein_g')
      .eq('user_id', userId)
      .neq('status', 'REPLACED')
      .lte('period_start', date)
      .or(`period_end.is.null,period_end.gte.${date}`)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  for (const result of [meals, workouts, activities, steps, totals, snapshot, cycle]) {
    if (result.error) throw result.error
  }
  const day = totals.data?.[0]
  const training = (
    kind: 'workout' | 'activity',
    row: {
      id: string
      custom_name: string | null
      duration_minutes: number
      estimated_calories: number
      manual_calories: number | null
      final_calories: number | null
      is_locked: boolean
      updated_at: string
    },
    type: string,
  ): TrainingRecord => ({
    id: row.id,
    kind,
    type,
    name: row.custom_name,
    durationMinutes: row.duration_minutes,
    estimatedCalories: row.estimated_calories,
    manualCalories: row.manual_calories,
    finalCalories: row.final_calories ?? row.manual_calories ?? row.estimated_calories,
    isLocked: row.is_locked,
    updatedAt: row.updated_at,
  })
  return {
    meals: (meals.data ?? []).map((meal) => ({
      id: meal.id,
      category: meal.meal_category,
      isLocked: meal.is_locked,
      updatedAt: meal.updated_at,
      items: meal.meal_items
        .filter((item) => !item.is_deleted)
        .map((item) => ({
          id: item.id,
          foodItemId: item.food_item_id,
          name: item.food_name_snapshot,
          quantity: item.quantity,
          unit: item.unit,
          calories: item.snapshot_calories,
          proteinG: item.snapshot_protein_g,
          updatedAt: item.updated_at,
        })),
    })),
    workouts: (workouts.data ?? []).map((row) => training('workout', row, row.workout_type)),
    activities: (activities.data ?? []).map((row) => training('activity', row, row.activity_type)),
    steps: (steps.data ?? []).map((row) => ({
      id: row.id,
      steps: row.steps,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    totals: day ? { calories: day.calories, proteinG: day.protein_g } : null,
    target: snapshot.data
      ? { calories: snapshot.data.calories, proteinG: snapshot.data.protein_g, source: 'snapshot' }
      : cycle.data
        ? {
            calories: cycle.data.final_calories,
            proteinG: cycle.data.final_protein_g,
            source: 'cycle',
          }
        : null,
  }
}

export interface WeightRecord {
  id: string
  date: string
  weightKg: number
  source: 'MANUAL' | 'INBODY'
  updatedAt: string
}

export interface InbodyRecord {
  reportId: string
  date: string
  status: string
  metrics: {
    weightKg: number | null
    bodyFatPercent: number | null
    muscleMassKg: number | null
    bmi: number | null
    bmrKcal: number | null
    updatedAt: string
  } | null
}

export async function fetchBodyRecords(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<{ weights: WeightRecord[]; inbody: InbodyRecord[] }> {
  const [weights, reports] = await Promise.all([
    supabase
      .from('weight_measurements')
      .select('id, measurement_date, weight_kg, source, updated_at')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('measurement_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('inbody_reports')
      .select(
        'id, report_date, extraction_status, inbody_metrics(weight_kg, body_fat_percent, muscle_mass_kg, bmi, bmr_kcal, updated_at)',
      )
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('report_date', { ascending: false })
      .limit(10),
  ])
  if (weights.error) throw weights.error
  if (reports.error) throw reports.error
  return {
    weights: weights.data.map((row) => ({
      id: row.id,
      date: row.measurement_date,
      weightKg: row.weight_kg,
      source: row.source,
      updatedAt: row.updated_at,
    })),
    inbody: reports.data.map((row) => {
      const metrics = Array.isArray(row.inbody_metrics) ? row.inbody_metrics[0] : row.inbody_metrics
      return {
        reportId: row.id,
        date: row.report_date,
        status: row.extraction_status,
        metrics: metrics
          ? {
              weightKg: metrics.weight_kg,
              bodyFatPercent: metrics.body_fat_percent,
              muscleMassKg: metrics.muscle_mass_kg,
              bmi: metrics.bmi,
              bmrKcal: metrics.bmr_kcal,
              updatedAt: metrics.updated_at,
            }
          : null,
      }
    }),
  }
}

export interface CycleRecord {
  id: string
  status: 'IN_REVIEW' | 'LOCKED' | 'REPLACED'
  processingMonth: string
  periodStart: string
  periodEnd: string | null
  generatedAt: string
  finalCalories: number
  finalProteinG: number
  workoutDaysPerWeek: number
  model: string
  promptVersion: string
}

/** Recommendation history (read-only here: reprocessing has its own workflow). */
export async function fetchRecommendationCycles(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<CycleRecord[]> {
  const { data, error } = await supabase
    .from('recommendation_cycles')
    .select(
      'id, status, processing_month, period_start, period_end, generated_at, final_calories, final_protein_g, workout_days_per_week, model, prompt_version',
    )
    .eq('user_id', userId)
    .order('period_start', { ascending: false })
    .order('generated_at', { ascending: false })
    .limit(12)
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    status: row.status,
    processingMonth: row.processing_month,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    finalCalories: row.final_calories,
    finalProteinG: row.final_protein_g,
    workoutDaysPerWeek: row.workout_days_per_week,
    model: row.model,
    promptVersion: row.prompt_version,
  }))
}

export interface GoalRecord {
  longTermGoal: string
  description: string | null
  focuses: string[]
}

export async function fetchActiveGoal(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<GoalRecord | null> {
  const { data, error } = await supabase
    .from('goals')
    .select('long_term_goal, description, goal_focuses(focus_type, priority)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    longTermGoal: data.long_term_goal,
    description: data.description,
    focuses: [...data.goal_focuses]
      .sort((a, b) => a.priority - b.priority)
      .map((focus) => focus.focus_type),
  }
}

export async function searchFoodsForCorrection(
  supabase: AppSupabaseClient,
  query: string,
): Promise<{ id: string; name: string; unit: string }[]> {
  const { data, error } = await supabase
    .from('food_items')
    .select('id, name, serving_unit')
    .eq('is_deleted', false)
    .is('merged_into_food_id', null)
    .ilike('name', `%${query.trim()}%`)
    .order('name')
    .limit(8)
  if (error) throw error
  return data.map((row) => ({ id: row.id, name: row.name, unit: row.serving_unit }))
}

// --- Admin actions -------------------------------------------------------------

export async function setUserActive(
  supabase: AppSupabaseClient,
  userId: string,
  active: boolean,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_active', {
    p_user_id: userId,
    p_active: active,
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) throw error
}

export type Correction =
  | {
      domain: 'meal_item'
      id: string
      version: string
      quantity: number
      foodItemId: string | null
    }
  | { domain: 'meal'; id: string; version: string; category: MealCategory }
  | {
      domain: 'training'
      kind: 'workout' | 'activity'
      id: string
      version: string
      type: string
      name: string | null
      durationMinutes: number
      manualCalories: number | null
    }
  | { domain: 'steps'; id: string; version: string; steps: number }
  | { domain: 'weight'; id: string; version: string; weightKg: number }
  | {
      domain: 'inbody'
      id: string
      version: string
      weightKg: number | null
      bodyFatPercent: number | null
      muscleMassKg: number | null
      bmi: number | null
      bmrKcal: number | null
    }
  | {
      domain: 'profile'
      id: string
      version: string
      name: string
      dateOfBirth: string
      gender: Gender
      heightCm: number
      activityLevel: ActivityLevel | null
      workoutDaysPerWeek: number | null
    }

const nullable = <T>(key: string, value: T | null) =>
  (value === null ? {} : { [key]: value }) as Record<string, T>

type Functions = Database['public']['Functions']

/**
 * SQL NULL is a meaningful value in some corrections ("use the estimate", "not
 * set", "no metric"); the generated RPC types don't model nullable arguments.
 */
function nullableArgs<A>(args: { [K in keyof A]: A[K] | null }): A {
  return args as A
}

/** Applies one domain-specific correction; the server validates everything. */
export async function applyCorrection(
  supabase: AppSupabaseClient,
  correction: Correction,
  reason: string | null,
): Promise<void> {
  const why = reason ? { p_reason: reason } : {}
  let result: { error: PostgrestError | null }
  switch (correction.domain) {
    case 'meal_item':
      result = await supabase.rpc('admin_correct_meal_item', {
        p_item_id: correction.id,
        p_expected_updated_at: correction.version,
        p_quantity: correction.quantity,
        ...nullable('p_food_item_id', correction.foodItemId),
        ...why,
      })
      break
    case 'meal':
      result = await supabase.rpc('admin_correct_meal', {
        p_meal_id: correction.id,
        p_expected_updated_at: correction.version,
        p_meal_category: correction.category,
        ...why,
      })
      break
    case 'training':
      result = await supabase.rpc(
        'admin_correct_training',
        nullableArgs<Functions['admin_correct_training']['Args']>({
          p_kind: correction.kind,
          p_id: correction.id,
          p_expected_updated_at: correction.version,
          p_type: correction.type,
          p_name: correction.name,
          p_duration_minutes: correction.durationMinutes,
          p_manual_calories: correction.manualCalories,
          ...why,
        }),
      )
      break
    case 'steps':
      result = await supabase.rpc('admin_correct_steps', {
        p_entry_id: correction.id,
        p_expected_updated_at: correction.version,
        p_steps: correction.steps,
        ...why,
      })
      break
    case 'weight':
      result = await supabase.rpc('admin_correct_weight', {
        p_id: correction.id,
        p_expected_updated_at: correction.version,
        p_weight_kg: correction.weightKg,
        ...why,
      })
      break
    case 'inbody':
      result = await supabase.rpc(
        'admin_correct_inbody_metrics',
        nullableArgs<Functions['admin_correct_inbody_metrics']['Args']>({
          p_report_id: correction.id,
          p_expected_updated_at: correction.version,
          p_weight_kg: correction.weightKg,
          p_body_fat_percent: correction.bodyFatPercent,
          p_muscle_mass_kg: correction.muscleMassKg,
          p_bmi: correction.bmi,
          p_bmr_kcal: correction.bmrKcal,
          ...why,
        }),
      )
      break
    case 'profile':
      result = await supabase.rpc(
        'admin_correct_profile',
        nullableArgs<Functions['admin_correct_profile']['Args']>({
          p_user_id: correction.id,
          p_expected_updated_at: correction.version,
          p_name: correction.name,
          p_date_of_birth: correction.dateOfBirth,
          p_gender: correction.gender,
          p_height_cm: correction.heightCm,
          p_activity_level: correction.activityLevel,
          p_workout_days_per_week: correction.workoutDaysPerWeek,
          ...why,
        }),
      )
      break
  }
  if (result.error) throw result.error
}

export type DeletableDomain = 'meal' | 'meal_item' | 'workout' | 'activity' | 'steps' | 'weight'

export async function deleteRecord(
  supabase: AppSupabaseClient,
  domain: DeletableDomain,
  id: string,
  version: string,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_record', {
    p_domain: domain,
    p_id: id,
    p_expected_updated_at: version,
    ...(reason ? { p_reason: reason } : {}),
  })
  if (error) throw error
}

// --- Edge Function actions ------------------------------------------------------

export class AdminActionError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AdminActionError'
    this.code = code
  }
}

async function invokeAdminUsers<T>(supabase: AppSupabaseClient, body: object): Promise<T> {
  const response = await supabase.functions.invoke<T>('admin-users', { body })
  const error: unknown = response.error
  if (error) {
    let code = 'SERVER_ERROR'
    if (error instanceof FunctionsHttpError) {
      try {
        const payload: unknown = await (error.context as Response).json()
        if (
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          typeof payload.error === 'string'
        ) {
          code = payload.error
        }
      } catch {
        // keep the generic code
      }
    }
    throw new AdminActionError(code)
  }
  if (response.data === null) throw new AdminActionError('SERVER_ERROR')
  return response.data
}

export function createUser(
  supabase: AppSupabaseClient,
  input: { phone: string; pin: string; role: 'USER' | 'MANAGER' | 'ADMIN' },
): Promise<{ user_id: string }> {
  return invokeAdminUsers(supabase, { action: 'create_user', ...input })
}

export async function resetPin(
  supabase: AppSupabaseClient,
  input: { userId: string; pin: string; reason: string | null },
): Promise<void> {
  await invokeAdminUsers(supabase, {
    action: 'reset_pin',
    user_id: input.userId,
    pin: input.pin,
    ...(input.reason ? { reason: input.reason } : {}),
  })
}

// --- Audit and dashboard ----------------------------------------------------------

export interface AuditEntry {
  id: string
  createdAt: string
  actorId: string | null
  actorName: string | null
  targetId: string | null
  targetName: string | null
  entityType: string
  entityId: string | null
  action: AuditAction
  reason: string | null
  oldValues: Json | null
  newValues: Json | null
}

export interface AuditFilters {
  from: string
  to: string
  action: AuditAction | null
  entity: string | null
  actor: string
  target: string
  targetUserId?: string
}

export const AUDIT_PAGE_SIZE = 25

export async function fetchAudit(
  supabase: AppSupabaseClient,
  filters: AuditFilters,
  page: number,
  pageSize = AUDIT_PAGE_SIZE,
): Promise<{ rows: AuditEntry[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_audit_log', {
    ...(filters.from ? { p_from: filters.from } : {}),
    ...(filters.to ? { p_to: filters.to } : {}),
    ...(filters.action ? { p_action: filters.action } : {}),
    ...(filters.entity ? { p_entity: filters.entity } : {}),
    ...(filters.actor.trim() ? { p_actor_search: filters.actor.trim() } : {}),
    ...(filters.target.trim() ? { p_target_search: filters.target.trim() } : {}),
    ...(filters.targetUserId ? { p_target_user_id: filters.targetUserId } : {}),
    p_limit: pageSize,
    p_offset: page * pageSize,
  })
  if (error) throw error
  return {
    total: data[0]?.total_count ?? 0,
    rows: data.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorId: row.actor_user_id,
      actorName: row.actor_name,
      targetId: row.target_user_id,
      targetName: row.target_name,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      reason: row.reason,
      oldValues: row.old_values_json,
      newValues: row.new_values_json,
    })),
  }
}

export interface DashboardSummary {
  activeUsers: number
  inactiveUsers: number
  incompleteProfiles: number
  recommendationsInReview: number
  recommendationsPending: number
  recommendationFailures: number
  activeGroups: number
  foodSubmissionsPending: number
  aiSpend: number
  aiBudget: number | null
  aiCurrency: string
}

export async function fetchDashboard(supabase: AppSupabaseClient): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc('admin_dashboard').single()
  if (error) throw error
  return {
    activeUsers: data.active_users,
    inactiveUsers: data.inactive_users,
    incompleteProfiles: data.incomplete_profiles,
    recommendationsInReview: data.recommendations_in_review,
    recommendationsPending: data.recommendations_pending,
    recommendationFailures: data.recommendation_failures,
    activeGroups: data.active_groups,
    foodSubmissionsPending: data.food_submissions_pending,
    aiSpend: data.ai_spend,
    aiBudget: data.ai_budget,
    aiCurrency: data.ai_currency,
  }
}
