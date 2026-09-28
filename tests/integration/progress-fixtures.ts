/**
 * Known history for Progress tests (integration and browser). Service role
 * only — local stack only. Dates are relative to TODAY (Asia/Kolkata), so the
 * expected numbers below hold on any run date.
 *
 *   Cycle A  TODAY-45 … TODAY-15   capacity 4   2,000 kcal · P140 C230 F65 Fi30
 *   Cycle B  TODAY-14 … open       capacity 3   1,900 kcal · P150 C220 F60 Fi30
 *   Tolerance 0.85 (nutrients), calories 0.85–1.10, via daily snapshots.
 *
 *   Food (1 serving = 100 kcal, P10 C12 F3 Fi2):
 *     TODAY-20 ×20 → 2,000 kcal (in range, P met)
 *     TODAY-16 ×15 → 1,500 kcal (below range, P150 ≥ 119 met)
 *     TODAY-10 ×19 → 1,900 kcal (in range, P190 ≥ 127.5 met)
 *     TODAY-5  ×10 → 1,000 kcal (below range, P100 < 127.5 not met)
 *     TODAY-3  ×30 → deleted meal (never counted)
 *     TODAY    ×5  →   500 kcal (today: charted, not in adherence)
 *
 *   Workouts: TODAY-9 ×2 (one day), TODAY-8, TODAY-2 (locked); TODAY-1 deleted.
 *   Activities: TODAY-12 Cricket 90 min 450 kcal; TODAY-4 Walking 40 min, manual 200.
 *   Weight: TODAY-40 81.0 InBody; TODAY-25 80.0; TODAY-10 79.2 manual + 79.0 InBody;
 *           TODAY-2 78.6; TODAY-1 70.0 deleted.
 *   InBody: TODAY-40 fat 24.0% muscle 31.0 kg; TODAY-10 fat 23.1% muscle 31.6 kg.
 *   Steps: TODAY-3 8,000; TODAY-2 6,000 then 10,000 (latest active).
 */
import { addDays } from '../../src/lib/dates/local-date.ts'

import type { Admin } from './home-fixtures.ts'
import { must, run, TODAY } from './home-fixtures.ts'

export interface Targets {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  capacity: number
}

export const CYCLE_A: Targets = {
  calories: 2000,
  protein: 140,
  carbs: 230,
  fat: 65,
  fiber: 30,
  capacity: 4,
}
export const CYCLE_B: Targets = {
  calories: 1900,
  protein: 150,
  carbs: 220,
  fat: 60,
  fiber: 30,
  capacity: 3,
}
export const CYCLE_A_START = addDays(TODAY, -45)
export const CYCLE_A_END = addDays(TODAY, -15)
export const CYCLE_B_START = addDays(TODAY, -14)

const monthOf = (date: string) => `${date.slice(0, 7)}-01`

async function createCycle(
  admin: Admin,
  userId: string,
  goalId: string,
  start: string,
  end: string | null,
  targets: Targets,
  sessions: string[],
): Promise<string> {
  const processingRun = await must(
    admin
      .from('recommendation_processing_runs')
      .insert({ processing_month: monthOf(start) })
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
        recommended_calories: targets.calories,
        recommended_protein_g: targets.protein,
        recommended_carbs_g: targets.carbs,
        recommended_fat_g: targets.fat,
        recommended_fiber_g: targets.fiber,
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
        processing_month: monthOf(start),
        processing_user_id: attempt.id,
        goal_id: goalId,
        workout_days_per_week: targets.capacity,
        period_start: start,
        period_end: end,
        generated_at: new Date().toISOString(),
        review_deadline: addDays(start, 1),
        status: 'LOCKED',
        locked_at: new Date().toISOString(),
        parsed_output_json: {},
        provider: 'test',
        model: 'test-model',
        prompt_version: 'v1',
        recommended_calories: targets.calories,
        recommended_protein_g: targets.protein,
        recommended_carbs_g: targets.carbs,
        recommended_fat_g: targets.fat,
        recommended_fiber_g: targets.fiber,
        final_calories: targets.calories,
        final_protein_g: targets.protein,
        final_carbs_g: targets.carbs,
        final_fat_g: targets.fat,
        final_fiber_g: targets.fiber,
        workout_plan_json: { sessions },
      })
      .select('id')
      .single(),
  )
  const snapshots = []
  for (let date = start; date <= (end ?? TODAY); date = addDays(date, 1)) {
    snapshots.push({
      user_id: userId,
      recommendation_cycle_id: cycle.id,
      target_date: date,
      calories: targets.calories,
      protein_g: targets.protein,
      carbs_g: targets.carbs,
      fat_g: targets.fat,
      fiber_g: targets.fiber,
      workouts_per_week: targets.capacity,
      nutrition_tolerance: 0.85,
      calorie_lower_tolerance: 0.85,
      calorie_upper_tolerance: 1.1,
    })
  }
  await run(admin.from('daily_target_snapshots').insert(snapshots))
  return cycle.id
}

async function logMeal(
  admin: Admin,
  userId: string,
  foodId: string,
  date: string,
  servings: number,
  deleted = false,
) {
  const meal = await must(
    admin
      .from('meals')
      .insert({ user_id: userId, meal_date: date, is_locked: date < TODAY })
      .select('id')
      .single(),
  )
  // Snapshot columns are required by the insert type; the trigger computes them.
  await run(
    admin.from('meal_items').insert({
      meal_id: meal.id,
      user_id: userId,
      food_item_id: foodId,
      quantity: servings,
      unit: '',
      food_name_snapshot: '',
      snapshot_calories: 0,
      snapshot_protein_g: 0,
      snapshot_carbs_g: 0,
      snapshot_fat_g: 0,
      snapshot_fiber_g: 0,
    }),
  )
  if (deleted) await run(admin.from('meals').update({ is_deleted: true }).eq('id', meal.id))
}

async function inBody(
  admin: Admin,
  userId: string,
  date: string,
  weight: number,
  fat: number,
  muscle: number,
) {
  const report = await must(
    admin
      .from('inbody_reports')
      .insert({
        user_id: userId,
        report_date: date,
        file_path: `inbody/${userId}/${date}-${String(Math.random()).slice(2, 8)}.pdf`,
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
      weight_kg: weight,
      body_fat_percent: fat,
      muscle_mass_kg: muscle,
    }),
  )
  // The InBody weight row is created by the database from the metrics.
}

/** Seeds the full known history above for one user. */
export async function seedProgressHistory(admin: Admin, userId: string, tag: string) {
  const goal = await must(
    admin
      .from('goals')
      .insert({ user_id: userId, long_term_goal: 'FAT_LOSS', effective_from: addDays(TODAY, -60) })
      .select('id')
      .single(),
  )
  await run(
    admin.from('goal_focuses').insert([
      { goal_id: goal.id, user_id: userId, focus_type: 'MUSCLE_BUILDING', priority: 1 },
      { goal_id: goal.id, user_id: userId, focus_type: 'ENDURANCE', priority: 2 },
    ]),
  )
  await createCycle(admin, userId, goal.id, CYCLE_A_START, CYCLE_A_END, CYCLE_A, [
    'Upper body',
    'Lower body',
    'Pull',
    'Full body',
  ])
  await createCycle(admin, userId, goal.id, CYCLE_B_START, null, CYCLE_B, [
    'Upper body',
    'Lower body',
    'Full body',
  ])

  const food = await must(
    admin
      .from('food_items')
      .insert({
        name: `Progress serving ${tag}`,
        serving_quantity: 1,
        serving_unit: 'serving',
        calories: 100,
        protein_g: 10,
        carbs_g: 12,
        fat_g: 3,
        fiber_g: 2,
        is_approximate: false,
      })
      .select('id')
      .single(),
  )
  for (const [offset, servings, deleted] of [
    [-20, 20, false],
    [-16, 15, false],
    [-10, 19, false],
    [-5, 10, false],
    [-3, 30, true],
    [0, 5, false],
  ] as const) {
    await logMeal(admin, userId, food.id, addDays(TODAY, offset), servings, deleted)
  }

  const workout = (
    offset: number,
    type: string,
    minutes: number,
    extra: Record<string, unknown> = {},
  ) => ({
    user_id: userId,
    workout_date: addDays(TODAY, offset),
    workout_type: type,
    duration_minutes: minutes,
    estimated_calories: minutes * 6,
    is_locked: offset < 0,
    ...extra,
  })
  await run(
    admin
      .from('workouts')
      .insert([
        workout(-9, 'CHEST', 45),
        workout(-9, 'CARDIO', 20),
        workout(-8, 'LEGS', 50),
        workout(-2, 'BACK', 40),
      ]),
  )
  await run(
    admin.from('workouts').insert(workout(-1, 'HIIT', 30, { is_locked: false, is_deleted: true })),
  )

  await run(
    admin.from('activities').insert([
      {
        user_id: userId,
        activity_date: addDays(TODAY, -12),
        activity_type: 'CRICKET',
        duration_minutes: 90,
        estimated_calories: 450,
        is_locked: true,
      },
      {
        user_id: userId,
        activity_date: addDays(TODAY, -4),
        activity_type: 'WALKING',
        duration_minutes: 40,
        estimated_calories: 160,
        manual_calories: 200,
        is_locked: true,
      },
    ]),
  )

  await inBody(admin, userId, addDays(TODAY, -40), 81.0, 24.0, 31.0)
  await run(
    admin.from('weight_measurements').insert([
      { user_id: userId, measurement_date: addDays(TODAY, -25), weight_kg: 80.0 },
      { user_id: userId, measurement_date: addDays(TODAY, -10), weight_kg: 79.2 },
      { user_id: userId, measurement_date: addDays(TODAY, -2), weight_kg: 78.6 },
    ]),
  )
  await inBody(admin, userId, addDays(TODAY, -10), 79.0, 23.1, 31.6)
  const deletedWeight = await must(
    admin
      .from('weight_measurements')
      .insert({ user_id: userId, measurement_date: addDays(TODAY, -1), weight_kg: 70.0 })
      .select('id')
      .single(),
  )
  await run(
    admin.from('weight_measurements').update({ is_deleted: true }).eq('id', deletedWeight.id),
  )

  await run(
    admin
      .from('steps_entries')
      .insert({ user_id: userId, entry_date: addDays(TODAY, -3), steps: 8000 }),
  )
  await run(
    admin
      .from('steps_entries')
      .insert({ user_id: userId, entry_date: addDays(TODAY, -2), steps: 6000 }),
  )
  await run(
    admin
      .from('steps_entries')
      .insert({ user_id: userId, entry_date: addDays(TODAY, -2), steps: 10000 }),
  )
}

/** Workout dates of the fixture (valid, non-deleted), for independent weekly checks. */
export const FIXTURE_WORKOUT_DATES = [-9, -9, -8, -2].map((offset) => addDays(TODAY, offset))
