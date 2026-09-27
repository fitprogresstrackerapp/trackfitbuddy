import type { Database } from '@/types/database'

export type AppRole = Database['public']['Enums']['app_role']
export type Gender = Database['public']['Enums']['gender']

export interface AccountProfile {
  id: string
  phone: string
  name: string | null
  dateOfBirth: string | null
  gender: Gender | null
  heightCm: number | null
  timezone: string
}

export interface ProfileReadiness {
  isComplete: boolean
  missingFields: string[]
}

/** The signed-in user's identity as seen through RLS. */
export interface Account {
  profile: AccountProfile
  roles: AppRole[]
  readiness: ProfileReadiness
}
