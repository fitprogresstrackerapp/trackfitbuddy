/**
 * Supabase implementation of the recommendation ProcessingRepository.
 *
 * Runs only inside the process-recommendations Edge Function with the
 * service-role client (never in a browser). Every query is bounded to one
 * user and the analysed window and selects only needed columns. All state
 * changes go through the SQL functions of migration 20261005000100, which
 * make them atomic.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { calendarWeekOf, todayInTimeZone } from '../../../src/lib/dates/local-date.ts'
import {
  analysisWindow,
  type InputSource,
  type SourceCycle,
} from '../../../src/features/recommendations/engine/input-builder.ts'
import type {
  ClaimRequest,
  ClaimResult,
  PendingAttempt,
  ProcessingMode,
  ProcessingRepository,
  UsageEntry,
} from '../../../src/features/recommendations/engine/processor.ts'
import type { RecommendationOutput } from '../../../src/features/recommendations/engine/output.ts'
import type { CycleInfo } from '../../../src/features/progress/types.ts'
import type { Database, Json } from '../../../src/types/database.ts'

export type ServiceClient = SupabaseClient<Database>

const CYCLE_COLUMNS =
  'id, status, period_start, period_end, review_deadline, goal_id, workout_days_per_week, final_calories, final_protein_g, final_carbs_g, final_fat_g, final_fiber_g'

const SNAPSHOT_COLUMNS =
  'target_date, calories, protein_g, carbs_g, fat_g, fiber_g, workouts_per_week, nutrition_tolerance, calorie_lower_tolerance, calorie_upper_tolerance'

interface CycleRow {
  id: string
  status: Database['public']['Enums']['recommendation_cycle_status']
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

function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R['data']> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null || result.data === undefined) throw new Error(`${what}: no data`)
  return result.data as NonNullable<R['data']>
}

const monthOf = (date: string) => `${date.slice(0, 7)}-01`

export class SupabaseProcessingRepository implements ProcessingRepository {
  constructor(private readonly db: ServiceClient) {}

  async loadSource(
    userId: string,
    _mode: ProcessingMode,
  ): Promise<InputSource & { goalId: string | null }> {
    const db = this.db
    const profile = must(
      await db
        .from('profiles')
        .select(
          'date_of_birth, gender, height_cm, activity_level, job, hobbies, workout_days_per_week, timezone',
        )
        .eq('id', userId)
        .single(),
      'profile',
    )
    const today = todayInTimeZone(profile.timezone)
    const month = monthOf(today)

    const [readiness, goal, previous, feedback, currentWeight, inbody] = await Promise.all([
      db.from('profile_readiness').select('missing_fields').eq('user_id', userId).maybeSingle(),
      db
        .from('goals')
        .select('id, long_term_goal, description, goal_focuses(focus_type, priority)')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle(),
      // The cycle the new one follows. This month's cycle is never "previous":
      // when reprocessing, it is the one being replaced.
      db
        .from('recommendation_cycles')
        .select(
          `${CYCLE_COLUMNS}, recommended_calories, recommended_protein_g, recommended_carbs_g, recommended_fat_g, recommended_fiber_g, parsed_output_json, workout_plan_json`,
        )
        .eq('user_id', userId)
        .neq('status', 'REPLACED')
        .lt('processing_month', month)
        .lt('period_start', today)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('recommendation_feedback')
        .select('feedback')
        .eq('user_id', userId)
        .eq('feedback_month', month)
        .maybeSingle(),
      db
        .from('current_weights')
        .select('weight_kg, measurement_date')
        .eq('user_id', userId)
        .maybeSingle(),
      db
        .from('inbody_reports')
        .select('report_date, inbody_metrics!inner(weight_kg, body_fat_percent, muscle_mass_kg)')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .lte('report_date', today)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    for (const [name, result] of Object.entries({
      readiness,
      goal,
      previous,
      feedback,
      currentWeight,
      inbody,
    })) {
      if (result.error) throw new Error(`${name}: ${result.error.message}`)
    }

    const previousRow = previous.data
    const previousCycle: SourceCycle | null = previousRow
      ? {
          ...(toCycle(previousRow) as CycleInfo),
          recommended: {
            calories: previousRow.recommended_calories,
            proteinG: previousRow.recommended_protein_g,
            carbsG: previousRow.recommended_carbs_g,
            fatG: previousRow.recommended_fat_g,
            fiberG: previousRow.recommended_fiber_g,
          },
          parsedOutput: previousRow.parsed_output_json,
          workoutPlan: previousRow.workout_plan_json,
        }
      : null

    const window = analysisWindow(today, previousCycle)
    const { period, fetched } = window
    const fetchedToToday = { start: fetched.start, end: today }

    const [cycles, snapshots, nutrition, workouts, activities, weights, composition, steps] =
      await Promise.all([
        db
          .from('recommendation_cycles')
          .select(CYCLE_COLUMNS)
          .eq('user_id', userId)
          .neq('status', 'REPLACED')
          .lte('period_start', fetchedToToday.end)
          .or(`period_end.is.null,period_end.gte.${fetchedToToday.start}`)
          .order('period_start'),
        db
          .from('daily_target_snapshots')
          .select(SNAPSHOT_COLUMNS)
          .eq('user_id', userId)
          .gte('target_date', fetchedToToday.start)
          .lte('target_date', fetchedToToday.end)
          .order('target_date'),
        db.rpc('recommendation_daily_nutrition', {
          p_user_id: userId,
          p_start: period.start,
          p_end: period.end,
        }),
        db
          .from('workouts')
          .select('workout_date, workout_type, duration_minutes, final_calories')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('workout_date', calendarWeekOf(period.start).start)
          .lte('workout_date', fetched.end)
          .order('workout_date'),
        db
          .from('activities')
          .select('activity_date, activity_type, duration_minutes, final_calories')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('activity_date', period.start)
          .lte('activity_date', period.end)
          .order('activity_date'),
        db
          .from('weight_measurements')
          .select('measurement_date, weight_kg, source, created_at')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('measurement_date', period.start)
          .lte('measurement_date', period.end)
          .order('measurement_date'),
        db
          .from('inbody_reports')
          .select('report_date, inbody_metrics!inner(body_fat_percent, muscle_mass_kg)')
          .eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('report_date', period.start)
          .lte('report_date', period.end)
          .order('report_date'),
        db
          .from('daily_steps')
          .select('entry_date, steps')
          .eq('user_id', userId)
          .gte('entry_date', period.start)
          .lte('entry_date', period.end)
          .order('entry_date'),
      ])

    const goalRow = goal.data
    const inbodyRow = inbody.data
    const inbodyMetrics = inbodyRow ? firstOf(inbodyRow.inbody_metrics) : null

    return {
      processingDate: today,
      profile: {
        dateOfBirth: profile.date_of_birth,
        gender: profile.gender,
        heightCm: profile.height_cm,
        activityLevel: profile.activity_level,
        job: profile.job,
        hobbies: profile.hobbies,
        workoutDaysPerWeek: profile.workout_days_per_week,
        missingFields: readiness.data?.missing_fields ?? ['profile'],
      },
      goal: goalRow
        ? {
            id: goalRow.id,
            longTermGoal: goalRow.long_term_goal,
            description: goalRow.description,
            focuses: [...goalRow.goal_focuses]
              .sort((a, b) => a.priority - b.priority)
              .map((focus) => focus.focus_type),
          }
        : null,
      goalId: goalRow?.id ?? null,
      previousCycle,
      cycles: must(cycles, 'cycles').flatMap((row) => {
        const cycle = toCycle(row)
        return cycle ? [cycle] : []
      }),
      snapshots: must(snapshots, 'snapshots'),
      nutritionDays: must(nutrition, 'nutrition').map((day) => ({
        date: day.nutrition_date,
        calories: day.calories,
        proteinG: day.protein_g,
        carbsG: day.carbs_g,
        fatG: day.fat_g,
        fiberG: day.fiber_g,
        itemCount: day.item_count,
      })),
      workouts: must(workouts, 'workouts').map((row) => ({
        date: row.workout_date,
        type: row.workout_type,
        durationMinutes: row.duration_minutes,
        calories: row.final_calories ?? 0,
      })),
      activities: must(activities, 'activities').map((row) => ({
        date: row.activity_date,
        type: row.activity_type,
        durationMinutes: row.duration_minutes,
        calories: row.final_calories ?? 0,
      })),
      weights: must(weights, 'weights').map((row) => ({
        date: row.measurement_date,
        weightKg: row.weight_kg,
        source: row.source,
        createdAt: row.created_at,
      })),
      composition: must(composition, 'composition').flatMap((row) => {
        const metrics = firstOf(row.inbody_metrics)
        return metrics
          ? [
              {
                date: row.report_date,
                bodyFatPercent: metrics.body_fat_percent,
                muscleMassKg: metrics.muscle_mass_kg,
              },
            ]
          : []
      }),
      steps: must(steps, 'steps').flatMap((row) =>
        row.entry_date !== null && row.steps !== null
          ? [{ date: row.entry_date, steps: row.steps }]
          : [],
      ),
      currentWeight:
        currentWeight.data?.weight_kg != null && currentWeight.data.measurement_date != null
          ? { date: currentWeight.data.measurement_date, weightKg: currentWeight.data.weight_kg }
          : null,
      latestInbody:
        inbodyRow && inbodyMetrics
          ? {
              date: inbodyRow.report_date,
              weightKg: inbodyMetrics.weight_kg,
              bodyFatPercent: inbodyMetrics.body_fat_percent,
              muscleMassKg: inbodyMetrics.muscle_mass_kg,
            }
          : null,
      feedback: feedback.data?.feedback ?? null,
    }
  }

  async claim(request: ClaimRequest): Promise<ClaimResult> {
    const data = must(
      await this.db.rpc('claim_recommendation_attempt', {
        p_attempt_id: request.attemptId,
        p_input: request.input as Json,
        p_estimated_cost: request.estimatedCost,
        p_provider: request.provider,
        p_model: request.model,
        p_prompt_version: request.promptVersion,
        p_pricing_version: request.pricingVersion,
        p_input_schema_version: request.inputSchemaVersion,
        p_goal_id: request.goalId,
        p_capacity: request.capacity,
      }),
      'claim',
    ) as { result: string; input?: unknown }
    if (data.result === 'CLAIMED') return { result: 'CLAIMED', input: data.input }
    if (data.result === 'BUDGET_EXCEEDED' || data.result === 'BUDGET_NOT_CONFIGURED') {
      return { result: data.result }
    }
    return { result: 'NOT_PENDING' }
  }

  async skip(attemptId: string, reason: string): Promise<void> {
    const { error } = await this.db.rpc('skip_recommendation_attempt', {
      p_attempt_id: attemptId,
      p_reason: reason,
    })
    if (error) throw new Error(`skip: ${error.message}`)
  }

  async fail(
    attemptId: string,
    reason: string,
    rawOutput: unknown,
    usage: UsageEntry[],
  ): Promise<void> {
    const { error } = await this.db.rpc('fail_recommendation_attempt', {
      p_attempt_id: attemptId,
      p_failure_reason: reason,
      p_raw_output: (rawOutput ?? null) as Json,
      p_usage: usage as unknown as Json,
    })
    if (error) throw new Error(`fail: ${error.message}`)
  }

  async complete(
    attemptId: string,
    rawOutput: unknown,
    parsed: RecommendationOutput,
    usage: UsageEntry[],
  ): Promise<string> {
    return must(
      await this.db.rpc('complete_recommendation_attempt', {
        p_attempt_id: attemptId,
        p_raw_output: rawOutput as Json,
        p_parsed: parsed as unknown as Json,
        p_usage: usage as unknown as Json,
      }),
      'complete',
    )
  }

  // --- Run orchestration -----------------------------------------------------

  async recoverStale(staleMinutes: number): Promise<number> {
    return must(
      await this.db.rpc('recover_stale_recommendation_attempts', { p_stale_minutes: staleMinutes }),
      'recover',
    )
  }

  async enqueue(params: {
    mode: ProcessingMode
    userIds: string[] | null
    allReady: boolean
    createdBy: string
    provider: string
    model: string
    promptVersion: string
    batchSize: number
    budgetLimit: number | null
    currency: string
  }): Promise<{ run_id: string; queued: number; skipped: number; ignored: number }> {
    const data = must(
      await this.db.rpc('enqueue_recommendation_run', {
        p_mode: params.mode,
        // Exactly one of user ids / all-ready is given (checked by the function).
        p_user_ids: params.userIds as string[],
        p_all_ready: params.allReady,
        p_created_by: params.createdBy,
        p_provider: params.provider,
        p_model: params.model,
        p_prompt_version: params.promptVersion,
        p_batch_size: params.batchSize,
        p_budget_limit: params.budgetLimit as number,
        p_currency: params.currency,
      }),
      'enqueue',
    )
    return data as { run_id: string; queued: number; skipped: number; ignored: number }
  }

  /** PENDING attempts, oldest first (optionally of one run). */
  async nextPending(limit: number, runId?: string): Promise<PendingAttempt[]> {
    let query = this.db
      .from('recommendation_processing_users')
      .select('id, user_id, processing_run_id, recommendation_processing_runs!inner(mode)')
      .eq('status', 'PENDING')
      .order('created_at')
      .order('batch_number')
      .limit(limit)
    if (runId) query = query.eq('processing_run_id', runId)
    return must(await query, 'pending').map((row) => ({
      id: row.id,
      userId: row.user_id,
      runId: row.processing_run_id,
      mode: (firstOf(row.recommendation_processing_runs)?.mode ?? 'PROCESS') as ProcessingMode,
    }))
  }

  async pendingCount(): Promise<number> {
    const { count, error } = await this.db
      .from('recommendation_processing_users')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING')
    if (error) throw new Error(`pending count: ${error.message}`)
    return count ?? 0
  }

  async refreshRun(runId: string, stoppedByBudget: boolean): Promise<string> {
    return must(
      await this.db.rpc('refresh_recommendation_run', {
        p_run_id: runId,
        p_stopped_by_budget: stoppedByBudget,
      }),
      'refresh run',
    )
  }
}

function firstOf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}
