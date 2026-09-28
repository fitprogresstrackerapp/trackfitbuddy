import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import type { Period } from '../types'
import {
  fetchBodyPeriod,
  fetchCurrentPlan,
  fetchNutritionPeriod,
  fetchStepsPeriod,
  fetchTrainingPeriod,
} from './progress-data'

/**
 * Keys are scoped to the user and the exact period, so switching ranges
 * reuses cached ranges and never refetches the whole page. Food and training
 * mutations invalidate `progressKeys.all(userId)`.
 */
export const progressKeys = {
  all: (userId: string) => ['progress', userId] as const,
  plan: (userId: string, today: string) => ['progress', userId, 'plan', today] as const,
  nutrition: (userId: string, period: Period) =>
    ['progress', userId, 'nutrition', period.start, period.end] as const,
  training: (userId: string, period: Period) =>
    ['progress', userId, 'training', period.start, period.end] as const,
  body: (userId: string, period: Period) =>
    ['progress', userId, 'body', period.start, period.end] as const,
  steps: (userId: string, period: Period) =>
    ['progress', userId, 'steps', period.start, period.end] as const,
}

/** History changes rarely while viewing; refetch when the user returns. */
const OPTIONS = {
  staleTime: 60_000,
  refetchOnWindowFocus: true,
  placeholderData: keepPreviousData,
} as const

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useCurrentPlan(userId: string, today: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: progressKeys.plan(userId, today),
    queryFn: () => fetchCurrentPlan(supabase, userId, today),
    staleTime: 5 * 60_000,
  })
}

export function useNutritionPeriod(userId: string, period: Period | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: progressKeys.nutrition(userId, period ?? { start: '', end: '' }),
    queryFn: () => fetchNutritionPeriod(supabase, userId, period ?? { start: '', end: '' }),
    enabled: period !== null,
    ...OPTIONS,
  })
}

export function useTrainingPeriod(userId: string, period: Period | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: progressKeys.training(userId, period ?? { start: '', end: '' }),
    queryFn: () => fetchTrainingPeriod(supabase, userId, period ?? { start: '', end: '' }),
    enabled: period !== null,
    ...OPTIONS,
  })
}

export function useBodyPeriod(userId: string, period: Period | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: progressKeys.body(userId, period ?? { start: '', end: '' }),
    queryFn: () => fetchBodyPeriod(supabase, userId, period ?? { start: '', end: '' }),
    enabled: period !== null,
    ...OPTIONS,
  })
}

export function useStepsPeriod(userId: string, period: Period) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: progressKeys.steps(userId, period),
    queryFn: () => fetchStepsPeriod(supabase, userId, period),
    ...OPTIONS,
  })
}
