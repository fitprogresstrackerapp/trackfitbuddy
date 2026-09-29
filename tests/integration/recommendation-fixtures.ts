/**
 * Seed data and helpers for recommendation-engine tests (integration and
 * browser). Service role only, local stack only. Processing itself always
 * goes through the real process-recommendations Edge Function, which uses
 * the mock AI provider (AI_PROVIDER=mock in supabase/functions/.env).
 */
import { addDays, addMonths } from '../../src/lib/dates/local-date.ts'
import type { Json } from '../../src/types/database.ts'

import { env, type BrowserClient } from './helpers.ts'
import { completeProfile, must, run, TODAY, type Admin } from './home-fixtures.ts'

export const MONTH = `${TODAY.slice(0, 7)}-01`
/** The 4th of last month: always inside the previous month. */
export const PREVIOUS_START = addDays(addMonths(MONTH, -1), 3)
export const PREVIOUS_MONTH = `${PREVIOUS_START.slice(0, 7)}-01`

export const PREVIOUS_TARGETS = { calories: 2000, protein: 140, carbs: 230, fat: 65, fiber: 30 }

/** Complete profile + active goal + workout capacity (the readiness rule). */
export async function makeReady(
  admin: Admin,
  userId: string,
  options: { capacity?: number; goal?: string; focuses?: string[]; effectiveFrom?: string } = {},
): Promise<string> {
  await completeProfile(admin, userId)
  await run(
    admin
      .from('profiles')
      .update({ workout_days_per_week: options.capacity ?? 4, activity_level: 'MODERATELY_ACTIVE' })
      .eq('id', userId),
  )
  const goal = await must(
    admin
      .from('goals')
      .insert({
        user_id: userId,
        long_term_goal: options.goal ?? 'FAT_LOSS',
        description: 'Feel fitter for weekend cricket.',
        effective_from: options.effectiveFrom ?? TODAY,
      })
      .select('id')
      .single(),
  )
  const focuses = options.focuses ?? ['MUSCLE_BUILDING', 'GENERAL_FITNESS']
  if (focuses.length > 0) {
    await run(
      admin.from('goal_focuses').insert(
        focuses.map((focus, index) => ({
          goal_id: goal.id,
          user_id: userId,
          focus_type: focus,
          priority: index + 1,
        })),
      ),
    )
  }
  return goal.id
}

/**
 * A previous recommendation cycle (locked, still open) from PREVIOUS_START,
 * with target snapshots (and tolerances) for every day up to yesterday.
 */
export async function seedPreviousCycle(
  admin: Admin,
  userId: string,
  goalId: string,
  capacity: number,
): Promise<string> {
  const processingRun = await must(
    admin
      .from('recommendation_processing_runs')
      .insert({ processing_month: PREVIOUS_MONTH })
      .select('id')
      .single(),
  )
  const attempt = await must(
    admin
      .from('recommendation_processing_users')
      .insert({
        processing_run_id: processingRun.id,
        user_id: userId,
        status: 'SUCCESS',
        processing_month: PREVIOUS_MONTH,
        parsed_recommendation_json: {},
        generated_at: new Date().toISOString(),
        recommended_calories: 1900,
        recommended_protein_g: PREVIOUS_TARGETS.protein,
        recommended_carbs_g: PREVIOUS_TARGETS.carbs,
        recommended_fat_g: PREVIOUS_TARGETS.fat,
        recommended_fiber_g: PREVIOUS_TARGETS.fiber,
        provider: 'test',
        model: 'test-model',
        prompt_version: 'recommendation-v1',
      })
      .select('id')
      .single(),
  )
  const cycle = await must(
    admin
      .from('recommendation_cycles')
      .insert({
        user_id: userId,
        processing_month: PREVIOUS_MONTH,
        processing_user_id: attempt.id,
        goal_id: goalId,
        workout_days_per_week: capacity,
        period_start: PREVIOUS_START,
        generated_at: new Date().toISOString(),
        review_deadline: addDays(PREVIOUS_START, 1),
        status: 'LOCKED',
        locked_at: new Date().toISOString(),
        parsed_output_json: {
          summary: 'Previous plan summary.',
          short_term_focus: ['GENERAL_FITNESS'],
        },
        provider: 'test',
        model: 'test-model',
        prompt_version: 'recommendation-v1',
        // The user edited calories during review: 1900 → 2000.
        recommended_calories: 1900,
        recommended_protein_g: PREVIOUS_TARGETS.protein,
        recommended_carbs_g: PREVIOUS_TARGETS.carbs,
        recommended_fat_g: PREVIOUS_TARGETS.fat,
        recommended_fiber_g: PREVIOUS_TARGETS.fiber,
        final_calories: PREVIOUS_TARGETS.calories,
        final_protein_g: PREVIOUS_TARGETS.protein,
        final_carbs_g: PREVIOUS_TARGETS.carbs,
        final_fat_g: PREVIOUS_TARGETS.fat,
        final_fiber_g: PREVIOUS_TARGETS.fiber,
        workout_plan_json: {
          sessions: [
            { name: 'Upper body', type: 'UPPER_BODY' },
            { name: 'Lower body', type: 'LOWER_BODY' },
            { name: 'Full body', type: 'FULL_BODY' },
          ],
        },
      })
      .select('id')
      .single(),
  )
  const snapshots = []
  for (let date = PREVIOUS_START; date < TODAY; date = addDays(date, 1)) {
    snapshots.push({
      user_id: userId,
      recommendation_cycle_id: cycle.id,
      target_date: date,
      calories: PREVIOUS_TARGETS.calories,
      protein_g: PREVIOUS_TARGETS.protein,
      carbs_g: PREVIOUS_TARGETS.carbs,
      fat_g: PREVIOUS_TARGETS.fat,
      fiber_g: PREVIOUS_TARGETS.fiber,
      workouts_per_week: capacity,
      nutrition_tolerance: 0.85,
      calorie_lower_tolerance: 0.85,
      calorie_upper_tolerance: 1.1,
    })
  }
  await run(admin.from('daily_target_snapshots').insert(snapshots))
  return cycle.id
}

export async function getSetting(admin: Admin, key: string): Promise<Json | undefined> {
  const { data, error } = await admin
    .from('system_settings')
    .select('value_json')
    .eq('key', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.value_json ?? undefined
}

/**
 * Writes a setting. A JSON null cannot be sent through the REST API (it
 * arrives as SQL NULL), so "not configured" is written by removing the row,
 * which the engine treats exactly like a null value.
 */
export async function setSetting(
  admin: Admin,
  key: string,
  value: Json | undefined,
): Promise<void> {
  if (value === null || value === undefined) {
    await run(admin.from('system_settings').delete().eq('key', key))
    return
  }
  await run(admin.from('system_settings').upsert({ key, value_json: value }))
}

export interface ProcessResponse {
  status: number
  body: Record<string, unknown>
}

/** Calls the Edge Function with a user's access token (or none). */
export async function callProcessing(
  client: BrowserClient | null,
  body: unknown,
): Promise<ProcessResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env().anonKey,
  }
  if (client) {
    const { data } = await client.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('No session')
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${env().supabaseUrl}/functions/v1/process-recommendations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    // non-JSON gateway response
  }
  return { status: response.status, body: payload }
}

/** Keeps calling "continue" until nothing is pending (bounded). */
export async function drainPending(client: BrowserClient, maxCalls = 10): Promise<void> {
  for (let call = 0; call < maxCalls; call += 1) {
    const response = await callProcessing(client, { action: 'continue' })
    if (response.status !== 200) throw new Error(`continue failed: ${String(response.status)}`)
    const batch = response.body.batch as { stopped_by_budget: boolean } | undefined
    if (response.body.pending === 0 || batch?.stopped_by_budget) return
  }
}

export async function attemptsFor(admin: Admin, userId: string) {
  return must(
    admin
      .from('recommendation_processing_users')
      .select(
        'id, status, attempt_number, skip_reason, failure_reason, raw_input_json, raw_output_json, parsed_recommendation_json, goal_id, workout_days_per_week, provider, model, prompt_version, pricing_version, input_tokens, output_tokens, estimated_cost, reserved_cost, processing_month, created_at',
      )
      .eq('user_id', userId)
      .order('created_at'),
  )
}

export async function cyclesFor(admin: Admin, userId: string) {
  return must(
    admin
      .from('recommendation_cycles')
      .select(
        'id, status, processing_month, period_start, period_end, review_deadline, goal_id, workout_days_per_week, previous_cycle_id, processing_user_id, locked_at, recommended_calories, final_calories, final_protein_g, workout_plan_json, parsed_output_json, provider, model, prompt_version',
      )
      .eq('user_id', userId)
      .order('created_at'),
  )
}
