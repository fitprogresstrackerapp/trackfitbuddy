import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import { adminKeys } from './admin-queries'
import {
  approveFoodSubmission,
  approveFoodSubmissions,
  createFood,
  fetchFoodDuplicates,
  listFoods,
  rejectFoodSubmission,
  setFoodActive,
  updateFood,
  type FoodFilters,
} from './food-admin-data'

export const foodAdminKeys = {
  all: ['admin', 'foods'] as const,
  list: (filters: FoodFilters, page: number) => ['admin', 'foods', 'list', filters, page] as const,
  duplicates: (name: string, exclude: string | null) =>
    ['admin', 'foods', 'duplicates', name, exclude] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useFoodList(filters: FoodFilters, page: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodAdminKeys.list(filters, page),
    queryFn: () => listFoods(supabase, filters, page),
    placeholderData: keepPreviousData,
  })
}

/** Likely duplicates of a name, asked for once typing pauses. */
export function useFoodDuplicates(name: string, excludeFoodId: string | null) {
  const supabase = useSupabase()
  const [debounced, setDebounced] = useState(name)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(name)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [name])
  const query = debounced.trim()
  return useQuery({
    queryKey: foodAdminKeys.duplicates(query, excludeFoodId),
    queryFn: () => fetchFoodDuplicates(supabase, query, excludeFoodId),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  })
}

/**
 * Every change refreshes the admin list, the dashboard count and the audit
 * log, and the signed-in admin's own Food caches (search, recent, my foods),
 * since the shared catalogue they read has changed.
 */
export function useFoodAdminMutations() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const onSuccess = () =>
    Promise.all(
      [foodAdminKeys.all, adminKeys.dashboard, adminKeys.audit, ['food'] as const].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )
  return {
    create: useMutation({
      mutationFn: (input: Parameters<typeof createFood>[1]) => createFood(supabase, input),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: Parameters<typeof updateFood>[1]) => updateFood(supabase, input),
      onSuccess,
    }),
    setActive: useMutation({
      mutationFn: (input: Parameters<typeof setFoodActive>[1]) => setFoodActive(supabase, input),
      onSuccess,
    }),
    approve: useMutation({
      mutationFn: (input: Parameters<typeof approveFoodSubmission>[1]) =>
        approveFoodSubmission(supabase, input),
      onSuccess,
    }),
    approveMany: useMutation({
      mutationFn: (input: Parameters<typeof approveFoodSubmissions>[1]) =>
        approveFoodSubmissions(supabase, input),
      onSuccess,
    }),
    reject: useMutation({
      mutationFn: (input: Parameters<typeof rejectFoodSubmission>[1]) =>
        rejectFoodSubmission(supabase, input),
      onSuccess,
    }),
  }
}
