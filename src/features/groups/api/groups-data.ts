import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

/*
 * Groups data access (spec §46–48). Every call is a server-side function
 * that acts for the signed-in user. The database decides membership,
 * privileges and what is visible, and returns only group-visible fields:
 * never weight, body composition, InBody, profile details, meals or
 * workouts.
 */

export type GroupRole = Database['public']['Enums']['group_role']

export interface GroupSummary {
  id: string
  name: string
  description: string | null
  /** The group's single join code (spec §46), shared by members to invite others. */
  code: string
  myRole: GroupRole
  memberCount: number
  joinedAt: string
  /** First date this user may view (their join day; creation day for leaders/admins). */
  historyFrom: string
}

export async function fetchMyGroups(supabase: AppSupabaseClient): Promise<GroupSummary[]> {
  const { data, error } = await supabase.rpc('get_my_groups')
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    myRole: row.my_role,
    memberCount: row.member_count,
    joinedAt: row.joined_at,
    historyFrom: row.history_from,
  }))
}

export interface GroupMember {
  userId: string
  name: string | null
  role: GroupRole
  joinedAt: string
}

export async function fetchGroupMembers(
  supabase: AppSupabaseClient,
  groupId: string,
): Promise<GroupMember[]> {
  const { data, error } = await supabase.rpc('get_group_members', { p_group_id: groupId })
  if (error) throw error
  return data.map((row) => ({
    userId: row.user_id,
    name: row.name,
    role: row.group_role,
    joinedAt: row.joined_at,
  }))
}

/** One member's group-visible day. `null` = nothing recorded (never zero). */
export interface MemberDay {
  userId: string
  name: string | null
  role: GroupRole
  calories: number | null
  caloriesTarget: number | null
  proteinG: number | null
  proteinTargetG: number | null
  steps: number | null
  /** Always null in Phase 1: there is no step goal. */
  stepsTarget: number | null
  workoutLogged: boolean
}

export async function fetchGroupDay(
  supabase: AppSupabaseClient,
  groupId: string,
  date: string,
): Promise<MemberDay[]> {
  const { data, error } = await supabase.rpc('get_group_member_day', {
    p_group_id: groupId,
    p_date: date,
  })
  if (error) throw error
  return data.map((row) => ({
    userId: row.user_id,
    name: row.name,
    role: row.group_role,
    calories: row.calories,
    caloriesTarget: row.calories_target,
    proteinG: row.protein_g,
    proteinTargetG: row.protein_target_g,
    steps: row.steps,
    stepsTarget: row.steps_target,
    workoutLogged: row.workout_logged,
  }))
}

export async function createGroup(
  supabase: AppSupabaseClient,
  input: { name: string; description: string | null },
): Promise<{ id: string; code: string }> {
  const { data, error } = await supabase
    .rpc('create_group', {
      p_name: input.name,
      ...(input.description === null ? {} : { p_description: input.description }),
    })
    .single()
  if (error) throw error
  return data
}

export interface GroupPreview {
  id: string
  name: string
  description: string | null
  memberCount: number
  alreadyMember: boolean
}

/** The group behind a code, for the confirm step; `null` for an unknown code. */
export async function previewGroup(
  supabase: AppSupabaseClient,
  code: string,
): Promise<GroupPreview | null> {
  const { data, error } = await supabase.rpc('preview_group', { p_code: code }).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    memberCount: data.member_count,
    alreadyMember: data.already_member,
  }
}

export async function joinGroup(supabase: AppSupabaseClient, code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group', { p_code: code })
  if (error) throw error
  return data
}

export async function leaveGroup(supabase: AppSupabaseClient, groupId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_group', { p_group_id: groupId })
  if (error) throw error
}

export async function removeMember(
  supabase: AppSupabaseClient,
  groupId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc('remove_group_member', {
    p_group_id: groupId,
    p_user_id: userId,
  })
  if (error) throw error
}

export async function setMemberRole(
  supabase: AppSupabaseClient,
  groupId: string,
  userId: string,
  role: GroupRole,
): Promise<void> {
  const { error } = await supabase.rpc('set_group_member_role', {
    p_group_id: groupId,
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw error
}
