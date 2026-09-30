import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { groupKeys } from '@/features/groups/api/groups-queries'
import { homeKeys } from '@/features/home/api/home-queries'
import { progressKeys } from '@/features/progress/api/progress-queries'
import { fetchTargetsForDate } from '@/features/nutrition/api/targets'
import { getSupabaseClient } from '@/lib/supabase/client'

import type { FoodSubmissionInput } from '../schemas'
import type { DraftItem, MealCategory } from '../types'
import {
  addItemsToMeal,
  copyMeal,
  deleteItem,
  deleteMeal,
  fetchCopyCandidates,
  fetchDayMeals,
  fetchFoodUsage,
  fetchMySubmissions,
  logMeal,
  searchFoods,
  submitFood,
  updateItemQuantity,
  updateMealCategory,
} from './food-data'

export const foodKeys = {
  all: (userId: string) => ['food', userId] as const,
  days: (userId: string) => ['food', userId, 'day'] as const,
  day: (userId: string, date: string) => ['food', userId, 'day', date] as const,
  targets: (userId: string, date: string) => ['food', userId, 'targets', date] as const,
  searches: (userId: string) => ['food', userId, 'search'] as const,
  search: (userId: string, query: string) => ['food', userId, 'search', query] as const,
  usages: (userId: string) => ['food', userId, 'usage'] as const,
  usage: (userId: string, order: 'recent' | 'frequent') =>
    ['food', userId, 'usage', order] as const,
  copyCandidates: (userId: string) => ['food', userId, 'copy'] as const,
  copyCandidatesFor: (userId: string, date: string) => ['food', userId, 'copy', date] as const,
  submissions: (userId: string) => ['food', userId, 'submissions'] as const,
}

/** Minimum characters before searching (mirrors search_foods). */
export const SEARCH_MIN_LENGTH = 2
export const SEARCH_DEBOUNCE_MS = 250

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useDayMeals(userId: string, date: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodKeys.day(userId, date),
    queryFn: () => fetchDayMeals(supabase, userId, date),
    staleTime: 30_000,
  })
}

export function useDayTargets(userId: string, date: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodKeys.targets(userId, date),
    queryFn: async () => (await fetchTargetsForDate(supabase, userId, date)).targets,
    staleTime: 5 * 60_000,
  })
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])
  return debounced
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Debounced server-side search; the previous results stay visible while typing. */
export function useFoodSearch(userId: string, query: string, enabled = true) {
  const supabase = useSupabase()
  const debounced = normalizeQuery(useDebouncedValue(query, SEARCH_DEBOUNCE_MS))
  const active = enabled && debounced.length >= SEARCH_MIN_LENGTH
  const result = useQuery({
    queryKey: foodKeys.search(userId, debounced),
    queryFn: () => searchFoods(supabase, debounced),
    enabled: active,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const pending = normalizeQuery(query) !== debounced
  return { ...result, active, pending, debouncedQuery: debounced }
}

export function useFoodUsage(userId: string, order: 'recent' | 'frequent', enabled = true) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodKeys.usage(userId, order),
    queryFn: () => fetchFoodUsage(supabase, order),
    enabled,
    staleTime: 60_000,
  })
}

export function useCopyCandidates(userId: string, date: string, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodKeys.copyCandidatesFor(userId, date),
    queryFn: () => fetchCopyCandidates(supabase, userId, date),
    enabled,
    staleTime: 30_000,
  })
}

export function useMySubmissions(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: foodKeys.submissions(userId),
    queryFn: () => fetchMySubmissions(supabase, userId),
    staleTime: 60_000,
  })
}

/**
 * After any meal change: the changed day, food usage (recent/frequent and
 * search ranking), copy candidates, Home and Progress. Targets are unaffected.
 * Nothing is updated optimistically — values come back from the database.
 */
async function invalidateAfterMealChange(queryClient: QueryClient, userId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: foodKeys.days(userId) }),
    queryClient.invalidateQueries({ queryKey: foodKeys.usages(userId) }),
    queryClient.invalidateQueries({ queryKey: foodKeys.searches(userId) }),
    queryClient.invalidateQueries({ queryKey: foodKeys.copyCandidates(userId) }),
    queryClient.invalidateQueries({ queryKey: homeKeys.all(userId) }),
    queryClient.invalidateQueries({ queryKey: progressKeys.all(userId) }),
    queryClient.invalidateQueries({ queryKey: groupKeys.all(userId) }),
  ])
}

export function useFoodMutations(userId: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const onSuccess = () => invalidateAfterMealChange(queryClient, userId)

  const saveMeal = useMutation({
    mutationFn: (input: {
      date: string
      category: MealCategory | null
      items: readonly DraftItem[]
      existingMealId: string | null
    }) =>
      input.existingMealId
        ? addItemsToMeal(supabase, { mealId: input.existingMealId, items: input.items }).then(
            () => input.existingMealId ?? '',
          )
        : logMeal(supabase, input),
    onSuccess,
  })

  const changeQuantity = useMutation({
    mutationFn: (input: { itemId: string; quantity: number }) =>
      updateItemQuantity(supabase, input),
    onSuccess,
  })

  const removeItem = useMutation({
    mutationFn: (itemId: string) => deleteItem(supabase, itemId),
    onSuccess,
  })

  const removeMeal = useMutation({
    mutationFn: (mealId: string) => deleteMeal(supabase, mealId),
    onSuccess,
  })

  const changeCategory = useMutation({
    mutationFn: (input: { mealId: string; category: MealCategory | null }) =>
      updateMealCategory(supabase, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: foodKeys.days(userId) }),
  })

  const duplicateMeal = useMutation({
    mutationFn: (input: { mealId: string; date: string }) => copyMeal(supabase, input),
    onSuccess,
  })

  const createFood = useMutation({
    mutationFn: (input: FoodSubmissionInput) => submitFood(supabase, userId, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: foodKeys.submissions(userId) }),
        queryClient.invalidateQueries({ queryKey: foodKeys.searches(userId) }),
      ]),
  })

  return {
    saveMeal,
    changeQuantity,
    removeItem,
    removeMeal,
    changeCategory,
    duplicateMeal,
    createFood,
  }
}
