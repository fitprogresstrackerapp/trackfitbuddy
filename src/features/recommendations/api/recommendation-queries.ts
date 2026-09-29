import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import {
  fetchHistory,
  fetchOverview,
  fetchUsage,
  runProcessing,
  type ProcessingCommand,
  type ProcessingResult,
} from './admin-data'
import {
  fetchMonthlyFeedback,
  fetchRecommendationHistory,
  saveMonthlyFeedback,
} from './recommendation-data'

export const recommendationKeys = {
  feedback: (userId: string, today: string) =>
    ['recommendations', userId, 'feedback', today] as const,
  history: (userId: string) => ['recommendations', userId, 'history'] as const,
  admin: ['admin', 'recommendations'] as const,
  overview: ['admin', 'recommendations', 'overview'] as const,
  usage: (month: string) => ['admin', 'recommendations', 'usage', month] as const,
  attempts: (page: number) => ['admin', 'recommendations', 'attempts', page] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useMonthlyFeedback(userId: string, today: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: recommendationKeys.feedback(userId, today),
    queryFn: () => fetchMonthlyFeedback(supabase, userId, today),
  })
}

export function useSaveFeedback(userId: string, today: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { month: string; feedback: string }) =>
      saveMonthlyFeedback(supabase, userId, input.month, input.feedback),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: recommendationKeys.feedback(userId, today) }),
  })
}

export function useRecommendationHistory(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: recommendationKeys.history(userId),
    queryFn: () => fetchRecommendationHistory(supabase, userId),
  })
}

// --- Admin ------------------------------------------------------------------

export function useProcessingOverview() {
  const supabase = useSupabase()
  return useQuery({ queryKey: recommendationKeys.overview, queryFn: () => fetchOverview(supabase) })
}

export function useAiUsage(month: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: recommendationKeys.usage(month),
    queryFn: () => fetchUsage(supabase, month),
  })
}

export function useAttemptHistory(page: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: recommendationKeys.attempts(page),
    queryFn: () => fetchHistory(supabase, page),
    placeholderData: keepPreviousData,
  })
}

/** Calls to "continue" after a start; each processes one batch (bounded). */
export const MAX_CONTINUE_CALLS = 20

/**
 * Starts processing, then keeps processing the next batch while users remain
 * PENDING, unless the budget stopped it. Everything is server-side: if the
 * page is closed, the pending users simply wait for the next "Continue".
 */
export function useRunProcessing(onProgress?: (result: ProcessingResult) => void) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (command: ProcessingCommand) => {
      const started = await runProcessing(supabase, command)
      onProgress?.(started)
      let result = started
      const totals = { ...result.batch }
      for (let call = 0; call < MAX_CONTINUE_CALLS; call += 1) {
        if (
          result.pending === 0 ||
          result.batch.stopped_by_budget ||
          result.batch.processed === 0
        ) {
          break
        }
        await queryClient.invalidateQueries({ queryKey: recommendationKeys.admin })
        result = await runProcessing(supabase, { action: 'continue' })
        onProgress?.(result)
        totals.processed += result.batch.processed
        totals.success += result.batch.success
        totals.failed += result.batch.failed
        totals.skipped += result.batch.skipped
        totals.errors += result.batch.errors
        totals.stopped_by_budget = result.batch.stopped_by_budget
        totals.stopped_by_time = result.batch.stopped_by_time
      }
      // Queue counts come from the start; pending/run statuses from the last call.
      return { ...started, runs: result.runs, pending: result.pending, batch: totals }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: recommendationKeys.admin }),
  })
}
