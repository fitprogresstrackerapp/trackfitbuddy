import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import {
  applyCorrection,
  createUser,
  deleteRecord,
  fetchActiveGoal,
  fetchAudit,
  fetchBodyRecords,
  fetchDashboard,
  fetchDayRecords,
  fetchRecommendationCycles,
  fetchUserAccount,
  listUsers,
  resetPin,
  setUserActive,
  type AuditFilters,
  type Correction,
  type DeletableDomain,
  type UserFilters,
} from './admin-data'

/**
 * Admin keys. Changes invalidate only what they affect:
 *   account status / PIN  → that user's account, the user list, audit, dashboard
 *   corrections           → that user's records (+ account for profile), audit
 *   new user              → user list, dashboard
 */
export const adminKeys = {
  users: ['admin', 'users'] as const,
  userList: (filters: UserFilters, page: number) => ['admin', 'users', filters, page] as const,
  user: (userId: string) => ['admin', 'user', userId] as const,
  account: (userId: string) => ['admin', 'user', userId, 'account'] as const,
  day: (userId: string, date: string) => ['admin', 'user', userId, 'day', date] as const,
  body: (userId: string) => ['admin', 'user', userId, 'body'] as const,
  cycles: (userId: string) => ['admin', 'user', userId, 'cycles'] as const,
  goal: (userId: string) => ['admin', 'user', userId, 'goal'] as const,
  audit: ['admin', 'audit'] as const,
  auditPage: (filters: AuditFilters, page: number, size: number) =>
    ['admin', 'audit', filters, page, size] as const,
  dashboard: ['admin', 'dashboard'] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useUserList(filters: UserFilters, page: number) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.userList(filters, page),
    queryFn: () => listUsers(supabase, filters, page),
    placeholderData: keepPreviousData,
  })
}

export function useUserAccount(userId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.account(userId),
    queryFn: () => fetchUserAccount(supabase, userId),
    retry: false,
  })
}

export function useDayRecords(userId: string, date: string, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.day(userId, date),
    queryFn: () => fetchDayRecords(supabase, userId, date),
    enabled,
  })
}

export function useBodyRecords(userId: string, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.body(userId),
    queryFn: () => fetchBodyRecords(supabase, userId),
    enabled,
  })
}

export function useRecommendationCycles(userId: string, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.cycles(userId),
    queryFn: () => fetchRecommendationCycles(supabase, userId),
    enabled,
  })
}

export function useActiveGoal(userId: string, enabled: boolean) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.goal(userId),
    queryFn: () => fetchActiveGoal(supabase, userId),
    enabled,
  })
}

export function useAudit(filters: AuditFilters, page: number, size: number, enabled = true) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: adminKeys.auditPage(filters, page, size),
    queryFn: () => fetchAudit(supabase, filters, page, size),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useDashboard() {
  const supabase = useSupabase()
  return useQuery({ queryKey: adminKeys.dashboard, queryFn: () => fetchDashboard(supabase) })
}

export function useAdminMutations(userId?: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const invalidate = (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  const create = useMutation({
    mutationFn: (input: { phone: string; pin: string; role: 'USER' | 'MANAGER' | 'ADMIN' }) =>
      createUser(supabase, input),
    onSuccess: () => invalidate(adminKeys.users, adminKeys.dashboard, adminKeys.audit),
  })
  const pin = useMutation({
    mutationFn: (input: { pin: string; reason: string | null }) =>
      resetPin(supabase, { userId: userId ?? '', ...input }),
    onSuccess: () => invalidate(adminKeys.audit),
  })
  const status = useMutation({
    mutationFn: (input: { active: boolean; reason: string | null }) =>
      setUserActive(supabase, userId ?? '', input.active, input.reason),
    onSuccess: () =>
      invalidate(
        adminKeys.account(userId ?? ''),
        adminKeys.users,
        adminKeys.dashboard,
        adminKeys.audit,
      ),
  })
  const correct = useMutation({
    mutationFn: (input: { correction: Correction; reason: string | null }) =>
      applyCorrection(supabase, input.correction, input.reason),
    // Records of this user only (Home/Progress caches belong to the signed-in
    // user; admins never correct their own account).
    onSuccess: () => invalidate(adminKeys.user(userId ?? ''), adminKeys.users, adminKeys.audit),
  })
  const remove = useMutation({
    mutationFn: (input: {
      domain: DeletableDomain
      id: string
      version: string
      reason: string | null
    }) => deleteRecord(supabase, input.domain, input.id, input.version, input.reason),
    onSuccess: () => invalidate(adminKeys.user(userId ?? ''), adminKeys.audit),
  })
  return { create, pin, status, correct, remove }
}
