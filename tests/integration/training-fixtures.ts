/**
 * Seed data for Workout/Activity tests (integration and browser). Service role
 * only — local stack only. Past records are created as they would exist after
 * their day ended: written by trusted code and locked.
 */
import type { Admin } from './home-fixtures.ts'
import { must } from './home-fixtures.ts'

export async function seedLockedWorkout(
  admin: Admin,
  userId: string,
  date: string,
  type = 'LEGS',
  durationMinutes = 40,
): Promise<string> {
  const row = await must(
    admin
      .from('workouts')
      .insert({
        user_id: userId,
        workout_date: date,
        workout_type: type,
        duration_minutes: durationMinutes,
        estimated_calories: durationMinutes * 6,
        is_locked: true,
      })
      .select('id')
      .single(),
  )
  return row.id
}

export async function seedLockedActivity(
  admin: Admin,
  userId: string,
  date: string,
  type = 'WALKING',
  durationMinutes = 30,
): Promise<string> {
  const row = await must(
    admin
      .from('activities')
      .insert({
        user_id: userId,
        activity_date: date,
        activity_type: type,
        duration_minutes: durationMinutes,
        estimated_calories: durationMinutes * 4,
        is_locked: true,
      })
      .select('id')
      .single(),
  )
  return row.id
}
