import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import { fetchHomeNutrition, fetchHomePlan, fetchHomeTraining } from './home-data'

/**
 * Stable query keys. Later features invalidate `homeKeys.all(userId)` after
 * logging food, workouts, activities or steps so Home refetches.
 */
export const homeKeys = {
  all: (userId: string) => ['home', userId] as const,
  plan: (userId: string, day: string) => ['home', userId, day, 'plan'] as const,
  nutrition: (userId: string, day: string) => ['home', userId, day, 'nutrition'] as const,
  training: (userId: string, day: string) => ['home', userId, day, 'training'] as const,
}

/** Refetch when the user returns to the tab; no polling, no realtime. */
const HOME_QUERY_OPTIONS = { staleTime: 30_000, refetchOnWindowFocus: true } as const

export function useHomePlan(userId: string, day: string) {
  const [supabase] = useState(getSupabaseClient)
  return useQuery({
    queryKey: homeKeys.plan(userId, day),
    queryFn: () => fetchHomePlan(supabase, userId, day),
    ...HOME_QUERY_OPTIONS,
  })
}

export function useHomeNutrition(userId: string, day: string) {
  const [supabase] = useState(getSupabaseClient)
  return useQuery({
    queryKey: homeKeys.nutrition(userId, day),
    queryFn: () => fetchHomeNutrition(supabase, userId, day),
    ...HOME_QUERY_OPTIONS,
  })
}

export function useHomeTraining(userId: string, day: string) {
  const [supabase] = useState(getSupabaseClient)
  return useQuery({
    queryKey: homeKeys.training(userId, day),
    queryFn: () => fetchHomeTraining(supabase, userId, day),
    ...HOME_QUERY_OPTIONS,
  })
}
