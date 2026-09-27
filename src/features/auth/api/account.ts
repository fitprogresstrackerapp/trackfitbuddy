import type { AppSupabaseClient } from '@/lib/supabase/client'

import type { Account } from '../types'

/** The profile is not visible to its owner: deactivated or deleted account. */
export class AccountUnavailableError extends Error {
  constructor() {
    super('Account unavailable')
    this.name = 'AccountUnavailableError'
  }
}

export const accountQueryKey = (userId: string) => ['account', userId] as const

/** Loads the caller's profile, roles and readiness — all through RLS. */
export async function fetchAccount(supabase: AppSupabaseClient, userId: string): Promise<Account> {
  const [profileResult, rolesResult, readinessResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, phone, name, date_of_birth, gender, height_cm, timezone')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase
      .from('profile_readiness')
      .select('is_profile_complete, missing_fields')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (profileResult.error) throw profileResult.error
  if (rolesResult.error) throw rolesResult.error
  if (readinessResult.error) throw readinessResult.error

  const profile = profileResult.data
  if (!profile) throw new AccountUnavailableError()

  return {
    profile: {
      id: profile.id,
      phone: profile.phone,
      name: profile.name,
      dateOfBirth: profile.date_of_birth,
      gender: profile.gender,
      heightCm: profile.height_cm,
      timezone: profile.timezone,
    },
    roles: rolesResult.data.map((row) => row.role),
    readiness: {
      isComplete: readinessResult.data?.is_profile_complete ?? false,
      missingFields: readinessResult.data?.missing_fields ?? [],
    },
  }
}
