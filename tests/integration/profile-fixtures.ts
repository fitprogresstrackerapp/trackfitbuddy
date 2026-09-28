/**
 * Profile test data (integration and browser). Service role only — local stack
 * only. A recommendation generated on `start` has its review window on
 * `start` and the next day (review_deadline = start + 1).
 */
import { addDays } from '../../src/lib/dates/local-date.ts'

import type { Admin } from './home-fixtures.ts'
import { must, run, TODAY } from './home-fixtures.ts'

export const REVIEW_TARGETS = { calories: 2000, protein: 140, carbs: 230, fat: 65, fiber: 30 }

/** An IN_REVIEW recommendation (3 sessions) with its goal and daily snapshots up to today. */
export async function seedRecommendation(
  admin: Admin,
  userId: string,
  start: string = TODAY,
): Promise<{ cycleId: string; goalId: string }> {
  const goal = await must(
    admin
      .from('goals')
      .insert({
        user_id: userId,
        long_term_goal: 'FAT_LOSS',
        description: 'Lean out for the season',
        effective_from: addDays(start, -20),
      })
      .select('id')
      .single(),
  )
  await run(
    admin
      .from('goal_focuses')
      .insert({ goal_id: goal.id, user_id: userId, focus_type: 'MUSCLE_BUILDING', priority: 1 }),
  )
  const month = `${start.slice(0, 7)}-01`
  const processingRun = await must(
    admin
      .from('recommendation_processing_runs')
      .insert({ processing_month: month })
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
        parsed_recommendation_json: {},
        generated_at: new Date().toISOString(),
        recommended_calories: REVIEW_TARGETS.calories,
        recommended_protein_g: REVIEW_TARGETS.protein,
        recommended_carbs_g: REVIEW_TARGETS.carbs,
        recommended_fat_g: REVIEW_TARGETS.fat,
        recommended_fiber_g: REVIEW_TARGETS.fiber,
        provider: 'test',
        model: 'test-model',
        prompt_version: 'v1',
      })
      .select('id')
      .single(),
  )
  const cycle = await must(
    admin
      .from('recommendation_cycles')
      .insert({
        user_id: userId,
        processing_month: month,
        processing_user_id: attempt.id,
        goal_id: goal.id,
        workout_days_per_week: 3,
        period_start: start,
        generated_at: new Date().toISOString(),
        review_deadline: addDays(start, 1),
        status: 'IN_REVIEW',
        parsed_output_json: {
          summary: 'Keep protein high and train three days a week.',
          workout_plan: { days_per_week: 3, sessions: ['Upper body', 'Lower body', 'Full body'] },
        },
        provider: 'test',
        model: 'test-model',
        prompt_version: 'v1',
        recommended_calories: REVIEW_TARGETS.calories,
        recommended_protein_g: REVIEW_TARGETS.protein,
        recommended_carbs_g: REVIEW_TARGETS.carbs,
        recommended_fat_g: REVIEW_TARGETS.fat,
        recommended_fiber_g: REVIEW_TARGETS.fiber,
        final_calories: REVIEW_TARGETS.calories,
        final_protein_g: REVIEW_TARGETS.protein,
        final_carbs_g: REVIEW_TARGETS.carbs,
        final_fat_g: REVIEW_TARGETS.fat,
        final_fiber_g: REVIEW_TARGETS.fiber,
        workout_plan_json: {
          sessions: [{ name: 'Upper body' }, { name: 'Lower body' }, { name: 'Full body' }],
        },
      })
      .select('id')
      .single(),
  )
  const snapshots = []
  for (let date = start; date <= TODAY; date = addDays(date, 1)) {
    snapshots.push({
      user_id: userId,
      recommendation_cycle_id: cycle.id,
      target_date: date,
      calories: REVIEW_TARGETS.calories,
      protein_g: REVIEW_TARGETS.protein,
      carbs_g: REVIEW_TARGETS.carbs,
      fat_g: REVIEW_TARGETS.fat,
      fiber_g: REVIEW_TARGETS.fiber,
      workouts_per_week: 3,
      nutrition_tolerance: 0.85,
      calorie_lower_tolerance: 0.85,
      calorie_upper_tolerance: 1.1,
    })
  }
  if (snapshots.length > 0) await run(admin.from('daily_target_snapshots').insert(snapshots))
  return { cycleId: cycle.id, goalId: goal.id }
}

/** A completed InBody report with metrics (its weight row is created by the database). */
export async function seedInbody(
  admin: Admin,
  userId: string,
  date: string,
  metrics: { weight: number; fat: number; muscle: number },
): Promise<string> {
  const report = await must(
    admin
      .from('inbody_reports')
      .insert({
        user_id: userId,
        report_date: date,
        file_path: `${userId}/${date}-seed-${String(Math.random()).slice(2, 8)}.pdf`,
        file_type: 'application/pdf',
        extraction_status: 'COMPLETED',
      })
      .select('id')
      .single(),
  )
  await run(
    admin.from('inbody_metrics').insert({
      report_id: report.id,
      user_id: userId,
      weight_kg: metrics.weight,
      body_fat_percent: metrics.fat,
      muscle_mass_kg: metrics.muscle,
    }),
  )
  return report.id
}
