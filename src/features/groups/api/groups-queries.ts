import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import {
  createGroup,
  fetchGroupDay,
  fetchGroupMembers,
  fetchMyGroups,
  joinGroup,
  leaveGroup,
  previewGroup,
  removeMember,
  setMemberRole,
  type GroupRole,
} from './groups-data'

/**
 * Keys live under ['groups', userId] so one targeted invalidation refreshes
 * every group view (after joining, leaving, removals, role changes and the
 * user's own meal / workout / steps changes). Group and date are part of the
 * key, so switching never shows another selection's data.
 */
export const groupKeys = {
  all: (userId: string) => ['groups', userId] as const,
  list: (userId: string) => ['groups', userId, 'list'] as const,
  members: (userId: string, groupId: string) => ['groups', userId, groupId, 'members'] as const,
  day: (userId: string, groupId: string, date: string) =>
    ['groups', userId, groupId, 'day', date] as const,
}

function useSupabase() {
  const [supabase] = useState(getSupabaseClient)
  return supabase
}

export function useMyGroups(userId: string) {
  const supabase = useSupabase()
  return useQuery({ queryKey: groupKeys.list(userId), queryFn: () => fetchMyGroups(supabase) })
}

export function useGroupMembers(userId: string, groupId: string) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: groupKeys.members(userId, groupId),
    queryFn: () => fetchGroupMembers(supabase, groupId),
  })
}

export function useGroupDay(userId: string, groupId: string, date: string, enabled = true) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: groupKeys.day(userId, groupId, date),
    queryFn: () => fetchGroupDay(supabase, groupId, date),
    enabled,
  })
}

export function usePreviewGroup() {
  const supabase = useSupabase()
  return useMutation({ mutationFn: (code: string) => previewGroup(supabase, code) })
}

export function useGroupMutations(userId: string) {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: groupKeys.all(userId) })

  const create = useMutation({
    mutationFn: (input: { name: string; description: string | null }) =>
      createGroup(supabase, input),
    onSuccess: refresh,
  })
  const join = useMutation({
    mutationFn: (code: string) => joinGroup(supabase, code),
    onSuccess: refresh,
  })
  const leave = useMutation({
    mutationFn: (groupId: string) => leaveGroup(supabase, groupId),
    // Drop every cached view of the group at once: access ended.
    onSuccess: (_data, groupId) => {
      queryClient.removeQueries({ queryKey: [...groupKeys.all(userId), groupId] })
      return refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (input: { groupId: string; userId: string }) =>
      removeMember(supabase, input.groupId, input.userId),
    onSuccess: refresh,
  })
  const setRole = useMutation({
    mutationFn: (input: { groupId: string; userId: string; role: GroupRole }) =>
      setMemberRole(supabase, input.groupId, input.userId, input.role),
    onSuccess: refresh,
  })
  return { create, join, leave, remove, setRole }
}
