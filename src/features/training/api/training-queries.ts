import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { homeKeys } from '@/features/home/api/home-queries'
import { progressKeys } from '@/features/progress/api/progress-queries'
import { getSupabaseClient } from '@/lib/supabase/client'

import type { TrainingInput } from '../schemas'
import type { TrainingKind } from '../types'
import {
  deleteTraining,
  fetchCalorieRates,
  fetchTrainingPlan,
  fetchTrainingWeek,
  logTraining,
  updateTraining,
} from './training-data'

export const trainingKeys = {
  all: (userId: string) => ['training', userId] as const,
  weeks: (userId: string) => ['training', userId, 'week'] as const,
  week: (userId: string, start: string, today: string) =>
    ['training', userId, 'week', start, today] as const,
  plan: (userId: string, date: string) => ['training', userId, 'plan', date] as const,
  rates: ['training-rates'] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useTrainingWeek(
  userId: string,
  week: { start: string; end: string },
  today: string,
) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: trainingKeys.week(userId, week.start, today),
    queryFn: () => fetchTrainingWeek(supabase, userId, week, today),
    staleTime: 30_000,
  })
}

export function useTrainingPlan(userId: string, date: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: trainingKeys.plan(userId, date),
    queryFn: () => fetchTrainingPlan(supabase, userId, date),
    staleTime: 5 * 60_000,
  })
}

export function useCalorieRates(enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: trainingKeys.rates,
    queryFn: () => fetchCalorieRates(supabase),
    enabled,
    staleTime: 60 * 60_000,
  })
}

/**
 * Mutations refetch the training weeks, Home and Progress (targets are unaffected).
 * Nothing is optimistic: stored calories come back from the database.
 */
export function useTrainingMutations(userId: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const onSuccess = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trainingKeys.weeks(userId) }),
      queryClient.invalidateQueries({ queryKey: homeKeys.all(userId) }),
      queryClient.invalidateQueries({ queryKey: progressKeys.all(userId) }),
    ])

  const create = useMutation({
    mutationFn: (input: { kind: TrainingKind; values: TrainingInput }) =>
      logTraining(supabase, input.kind, input.values),
    onSuccess,
  })
  const update = useMutation({
    mutationFn: (input: { kind: TrainingKind; id: string; values: TrainingInput }) =>
      updateTraining(supabase, input.kind, input.id, input.values),
    onSuccess,
  })
  const remove = useMutation({
    mutationFn: (input: { kind: TrainingKind; id: string }) =>
      deleteTraining(supabase, input.kind, input.id),
    onSuccess,
  })
  return { create, update, remove }
}
