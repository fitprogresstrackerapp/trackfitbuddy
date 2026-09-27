import type { AppSupabaseClient } from '@/lib/supabase/client'

import type { BasicsInput, MeasurementsInput } from '../schemas'

export class OnboardingSaveError extends Error {
  constructor() {
    super('Could not save your details. Check your connection and try again.')
    this.name = 'OnboardingSaveError'
  }
}

/** Step 1: saved immediately so a refresh resumes at step 2. */
export async function saveBasics(
  supabase: AppSupabaseClient,
  userId: string,
  input: BasicsInput,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ name: input.name, date_of_birth: input.dateOfBirth, gender: input.gender })
    .eq('id', userId)
  if (error) throw new OnboardingSaveError()
}

/**
 * Step 2: height and the initial weight in one database transaction. The
 * function is idempotent — a retry updates today's measurement, never
 * duplicates it.
 */
export async function saveMeasurements(
  supabase: AppSupabaseClient,
  input: MeasurementsInput,
): Promise<void> {
  const { error } = await supabase.rpc('save_onboarding_measurements', {
    p_height_cm: input.heightCm,
    p_weight_kg: input.weightKg,
  })
  if (error) throw new OnboardingSaveError()
}
