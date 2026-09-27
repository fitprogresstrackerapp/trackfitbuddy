/**
 * Seed data for Home tests (integration and browser). Service role only —
 * local stack only.
 */
import { addDays, calendarWeekOf, todayInTimeZone } from '../../src/lib/dates/local-date.ts'

import type { adminClient } from './helpers.ts'

export const TODAY = todayInTimeZone('Asia/Kolkata') // profile default timezone
export const WEEK = calendarWeekOf(TODAY)

export type Admin = ReturnType<typeof adminClient>

/** Unwraps a Supabase result, failing loudly on errors or missing rows. */
export async function must<T>(
  promise: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const { data, error } = await promise
  if (error) throw new Error(JSON.stringify(error))
  if (data === null || data === undefined) throw new Error('No data returned')
  return data
}

/** Awaits a write that returns no rows, failing loudly on errors. */
export async function run(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise
  if (error) throw new Error(JSON.stringify(error))
}

/** All mandatory profile fields, including a current weight (profile_readiness). */
export async function completeProfile(admin: Admin, userId: string) {
  await run(
    admin
      .from('profiles')
      .update({ name: 'Home Test', date_of_birth: '1992-03-14', gender: 'FEMALE', height_cm: 166 })
      .eq('id', userId),
  )
  await run(
    admin
      .from('weight_measurements')
      .insert({ user_id: userId, measurement_date: addDays(TODAY, -2), weight_kg: 61.5 }),
  )
}

/** A locked recommendation cycle covering today, with its goal; optionally today's snapshot. */
export async function seedPlan(admin: Admin, userId: string, withSnapshot: boolean) {
  const goal = await must(
    admin
      .from('goals')
      .insert({ user_id: userId, long_term_goal: 'FAT_LOSS', effective_from: TODAY })
      .select('id')
      .single(),
  )
  await run(
    admin.from('goal_focuses').insert([
      { goal_id: goal.id, user_id: userId, focus_type: 'GENERAL_FITNESS', priority: 2 },
      { goal_id: goal.id, user_id: userId, focus_type: 'MUSCLE_BUILDING', priority: 1 },
    ]),
  )
  const processingRun = await must(
    admin
      .from('recommendation_processing_runs')
      .insert({ processing_month: `${TODAY.slice(0, 7)}-01` })
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
        recommended_calories: 2000,
        recommended_protein_g: 140,
        recommended_carbs_g: 230,
        recommended_fat_g: 65,
        recommended_fiber_g: 30,
        provider: 'test',
        model: 'test-model',
        prompt_version: 'v1',
      })
      .select('id')
      .single(),
  )
  const periodStart = addDays(TODAY, -10)
  const cycle = await must(
    admin
      .from('recommendation_cycles')
      .insert({
        user_id: userId,
        processing_month: `${TODAY.slice(0, 7)}-01`,
        processing_user_id: attempt.id,
        goal_id: goal.id,
        workout_days_per_week: 4,
        period_start: periodStart,
        generated_at: new Date().toISOString(),
        review_deadline: addDays(periodStart, 1),
        status: 'LOCKED',
        locked_at: new Date().toISOString(),
        parsed_output_json: {},
        provider: 'test',
        model: 'test-model',
        prompt_version: 'v1',
        recommended_calories: 2000,
        recommended_protein_g: 140,
        recommended_carbs_g: 230,
        recommended_fat_g: 65,
        recommended_fiber_g: 30,
        final_calories: 2100,
        final_protein_g: 150,
        final_carbs_g: 240,
        final_fat_g: 70,
        final_fiber_g: 32,
        workout_plan_json: { sessions: [{ name: 'Upper body' }, { name: 'Lower body' }] },
      })
      .select('id')
      .single(),
  )
  if (withSnapshot) {
    await run(
      admin.from('daily_target_snapshots').insert({
        user_id: userId,
        recommendation_cycle_id: cycle.id,
        target_date: TODAY,
        calories: 2000,
        protein_g: 140,
        carbs_g: 230,
        fat_g: 65,
        fiber_g: 30,
        workouts_per_week: 4,
        nutrition_tolerance: 0.85,
        calorie_lower_tolerance: 0.85,
        calorie_upper_tolerance: 1.1,
      }),
    )
  }
}

/** Meals, steps, workouts and activities — including rows that must NOT count. */
export async function seedDay(admin: Admin, userId: string) {
  const food = await must(
    admin
      .from('food_items')
      .insert({
        name: `Home test food ${userId.slice(0, 8)}`,
        serving_quantity: 100,
        serving_unit: 'g',
        calories: 200,
        protein_g: 20,
        carbs_g: 10,
        fat_g: 5,
        fiber_g: 2,
      })
      .select('id')
      .single(),
  )
  const [lunch, deletedMeal, yesterday] = await must(
    admin
      .from('meals')
      .insert([
        { user_id: userId, meal_date: TODAY },
        { user_id: userId, meal_date: TODAY },
        { user_id: userId, meal_date: addDays(TODAY, -1) },
      ])
      .select('id'),
  )
  if (!lunch || !deletedMeal || !yesterday) throw new Error('meals not created')
  // Snapshot columns are required by the insert type but always computed by the
  // database trigger from the food and quantity; these placeholders are overwritten.
  const mealItem = (mealId: string, quantity: number) => ({
    meal_id: mealId,
    user_id: userId,
    food_item_id: food.id,
    quantity,
    unit: 'g',
    food_name_snapshot: '',
    snapshot_calories: 0,
    snapshot_protein_g: 0,
    snapshot_carbs_g: 0,
    snapshot_fat_g: 0,
    snapshot_fiber_g: 0,
  })
  const items = await must(
    admin
      .from('meal_items')
      .insert([
        mealItem(lunch.id, 100),
        mealItem(lunch.id, 50),
        mealItem(lunch.id, 300), // deleted below
        mealItem(deletedMeal.id, 100),
        mealItem(yesterday.id, 100),
      ])
      .select('id'),
  )
  await run(
    admin
      .from('meal_items')
      .update({ is_deleted: true })
      .eq('id', items[2]?.id ?? ''),
  )
  await run(admin.from('meals').update({ is_deleted: true }).eq('id', deletedMeal.id))
  // Changing the food master afterwards must not change logged snapshots.
  await run(admin.from('food_items').update({ calories: 999 }).eq('id', food.id))

  await run(admin.from('steps_entries').insert({ user_id: userId, entry_date: TODAY, steps: 3000 }))
  await run(admin.from('steps_entries').insert({ user_id: userId, entry_date: TODAY, steps: 7842 }))
  await run(
    admin
      .from('steps_entries')
      .insert({ user_id: userId, entry_date: addDays(TODAY, -1), steps: 12000 }),
  )

  const workouts = await must(
    admin
      .from('workouts')
      .insert([
        {
          user_id: userId,
          workout_date: TODAY,
          workout_type: 'CHEST_TRICEPS',
          duration_minutes: 52,
          estimated_calories: 310,
        },
        {
          user_id: userId,
          workout_date: TODAY,
          workout_type: 'LEGS',
          duration_minutes: 40,
          estimated_calories: 250,
        }, // deleted
        {
          user_id: userId,
          workout_date: WEEK.start,
          workout_type: 'BACK',
          duration_minutes: 45,
          estimated_calories: 280,
        },
        {
          user_id: userId,
          workout_date: addDays(WEEK.start, -1),
          workout_type: 'FULL_BODY',
          duration_minutes: 60,
          estimated_calories: 400,
        }, // last week
      ])
      .select('id'),
  )
  await run(
    admin
      .from('workouts')
      .update({ is_deleted: true })
      .eq('id', workouts[1]?.id ?? ''),
  )

  const activities = await must(
    admin
      .from('activities')
      .insert([
        {
          user_id: userId,
          activity_date: TODAY,
          activity_type: 'CRICKET',
          duration_minutes: 60,
          estimated_calories: 420,
        },
        {
          user_id: userId,
          activity_date: TODAY,
          activity_type: 'RUNNING',
          duration_minutes: 30,
          estimated_calories: 300,
        }, // deleted
      ])
      .select('id'),
  )
  await run(
    admin
      .from('activities')
      .update({ is_deleted: true })
      .eq('id', activities[1]?.id ?? ''),
  )
}
