import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useAuth } from '@/features/auth/auth-context'
import type { Gender } from '@/features/auth/types'
import { homeKeys } from '@/features/home/api/home-queries'
import { progressKeys } from '@/features/progress/api/progress-queries'
import { trainingKeys } from '@/features/training/api/training-queries'
import { getSupabaseClient } from '@/lib/supabase/client'

import type {
  GoalInput,
  LifestyleInput,
  ReviewInput,
  StepsEntryInput,
  WeightEntryInput,
} from '../schemas'
import {
  acceptRecommendation,
  deleteSteps,
  deleteWeight,
  fetchInbodyReports,
  fetchPlan,
  fetchProfileDetails,
  fetchRecentSteps,
  fetchWeights,
  logSteps,
  logWeight,
  reviewRecommendation,
  saveGoal,
  updateCapacity,
  updateHeight,
  updateLifestyle,
  updatePersonal,
  updateWeight,
  uploadInbodyReport,
} from './profile-data'

export const profileKeys = {
  all: (userId: string) => ['profile', userId] as const,
  details: (userId: string) => ['profile', userId, 'details'] as const,
  weights: (userId: string) => ['profile', userId, 'weights'] as const,
  steps: (userId: string, today: string) => ['profile', userId, 'steps', today] as const,
  stepsAll: (userId: string) => ['profile', userId, 'steps'] as const,
  inbody: (userId: string) => ['profile', userId, 'inbody'] as const,
  plan: (userId: string, today: string) => ['profile', userId, 'plan', today] as const,
  planAll: (userId: string) => ['profile', userId, 'plan'] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useProfileDetails(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: profileKeys.details(userId),
    queryFn: () => fetchProfileDetails(supabase, userId),
  })
}

export function useWeights(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: profileKeys.weights(userId),
    queryFn: () => fetchWeights(supabase, userId),
  })
}

export function useRecentSteps(userId: string, today: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: profileKeys.steps(userId, today),
    queryFn: () => fetchRecentSteps(supabase, userId, today),
  })
}

export function useInbodyReports(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: profileKeys.inbody(userId),
    queryFn: () => fetchInbodyReports(supabase, userId),
  })
}

export function usePlan(userId: string, today: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: profileKeys.plan(userId, today),
    queryFn: () => fetchPlan(supabase, userId, today),
  })
}

/**
 * Mutations wait for the server, then refresh only what they affect:
 *   personal / height      → account (greeting, readiness), details, Home
 *   lifestyle / capacity   → details (next-cycle inputs; nothing current changes)
 *   weight                 → weights, account readiness, Progress
 *   steps                  → steps, Home, Progress
 *   InBody                 → InBody list, weights, Progress
 *   goals                  → plan, Progress (current cycle goals are unchanged)
 *   recommendation review  → plan, Home, Progress, training plan, food targets
 */
export function useProfileMutations(userId: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const { refreshAccount } = useAuth()
  const invalidate = (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  const personal = useMutation({
    mutationFn: (input: { name: string; dateOfBirth: string; gender: Gender }) =>
      updatePersonal(supabase, userId, input),
    onSuccess: () =>
      Promise.all([
        refreshAccount(),
        invalidate(profileKeys.details(userId), homeKeys.all(userId)),
      ]),
  })

  const height = useMutation({
    mutationFn: (heightCm: number) => updateHeight(supabase, userId, heightCm),
    onSuccess: () => Promise.all([refreshAccount(), invalidate(profileKeys.details(userId))]),
  })

  const lifestyle = useMutation({
    mutationFn: (input: LifestyleInput) => updateLifestyle(supabase, userId, input),
    onSuccess: () => invalidate(profileKeys.details(userId)),
  })

  const capacity = useMutation({
    mutationFn: (days: number) => updateCapacity(supabase, userId, days),
    onSuccess: () => invalidate(profileKeys.details(userId)),
  })

  const afterWeight = () =>
    Promise.all([
      refreshAccount(),
      invalidate(profileKeys.weights(userId), progressKeys.all(userId)),
    ])
  const addWeight = useMutation({
    mutationFn: (input: WeightEntryInput) => logWeight(supabase, input),
    onSuccess: afterWeight,
  })
  const editWeight = useMutation({
    mutationFn: (input: { id: string; weightKg: number }) =>
      updateWeight(supabase, input.id, input.weightKg),
    onSuccess: afterWeight,
  })
  const removeWeight = useMutation({
    mutationFn: (id: string) => deleteWeight(supabase, id),
    onSuccess: afterWeight,
  })

  const afterSteps = () =>
    invalidate(profileKeys.stepsAll(userId), homeKeys.all(userId), progressKeys.all(userId))
  const addSteps = useMutation({
    mutationFn: (input: StepsEntryInput) => logSteps(supabase, input),
    onSuccess: afterSteps,
  })
  const removeSteps = useMutation({
    mutationFn: (id: string) => deleteSteps(supabase, id),
    onSuccess: afterSteps,
  })

  const inbody = useMutation({
    mutationFn: (input: { date: string; file: File }) =>
      uploadInbodyReport(supabase, userId, input),
    onSuccess: () =>
      invalidate(profileKeys.inbody(userId), profileKeys.weights(userId), progressKeys.all(userId)),
  })

  const goal = useMutation({
    mutationFn: (input: GoalInput) => saveGoal(supabase, input),
    onSuccess: () => invalidate(profileKeys.planAll(userId), progressKeys.all(userId)),
  })

  const afterReview = () =>
    invalidate(
      profileKeys.planAll(userId),
      homeKeys.all(userId),
      progressKeys.all(userId),
      trainingKeys.all(userId),
      ['food', userId, 'targets'],
      ['recommendations', userId],
    )
  const review = useMutation({
    mutationFn: (input: { cycleId: string; values: ReviewInput }) =>
      reviewRecommendation(supabase, input.cycleId, input.values),
    onSuccess: afterReview,
  })
  const accept = useMutation({
    mutationFn: (cycleId: string) => acceptRecommendation(supabase, cycleId),
    onSuccess: afterReview,
  })

  return {
    personal,
    height,
    lifestyle,
    capacity,
    addWeight,
    editWeight,
    removeWeight,
    addSteps,
    removeSteps,
    inbody,
    goal,
    review,
    accept,
  }
}
