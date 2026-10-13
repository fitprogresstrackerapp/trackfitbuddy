import type { FoodSubmissionInput } from '@/features/food/schemas'
import type { AppSupabaseClient } from '@/lib/supabase/client'

/*
 * Admin Food Database (spec §11, §78). Every call is an admin function in the
 * database: it checks the caller's role itself, validates the values and
 * refuses a stale edit. Nothing here writes to a table directly.
 *
 * One list covers both tables of the food model:
 *   FOOD        a shared food (active or inactive)
 *   SUBMISSION  a user-created food that is not shared: pending or rejected
 * Nutrition values are per `servingQuantity` of `servingUnit`, as stored.
 */

export const FOODS_PAGE_SIZE = 25

export type FoodAdminStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_REVIEW' | 'REJECTED'
export type FoodSource = 'CATALOGUE' | 'ADMIN' | 'USER_SUBMISSION'
export type FoodSort = 'NAME' | 'NEWEST' | 'UPDATED' | 'STATUS'

export interface FoodFilters {
  search: string
  status: FoodAdminStatus | null
  source: FoodSource | null
  sort: FoodSort
}

export interface FoodValues {
  name: string
  servingQuantity: number
  servingUnit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
}

export interface FoodAdminRow extends FoodValues {
  kind: 'FOOD' | 'SUBMISSION'
  id: string
  isApproximate: boolean
  status: FoodAdminStatus
  source: FoodSource
  /** The submitting user's name (user-created foods only). Nothing else of the user. */
  submittedByName: string | null
  /** Review note (submissions) or the reason a food was deactivated. */
  notes: string | null
  createdAt: string
  /** Also the version an edit must match. */
  updatedAt: string
  version: number | null
}

export interface FoodDuplicate extends FoodValues {
  id: string
  status: 'ACTIVE' | 'INACTIVE'
  isExact: boolean
}

interface ValueColumns {
  name: string
  serving_quantity: number
  serving_unit: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
}

const toValues = (row: ValueColumns): FoodValues => ({
  name: row.name,
  servingQuantity: row.serving_quantity,
  servingUnit: row.serving_unit,
  calories: row.calories,
  proteinG: row.protein_g,
  carbsG: row.carbs_g,
  fatG: row.fat_g,
  fiberG: row.fiber_g,
})

const valueArgs = (values: FoodSubmissionInput) => ({
  p_name: values.name,
  p_serving_quantity: values.servingQuantity,
  p_serving_unit: values.servingUnit,
  p_calories: values.calories,
  p_protein_g: values.proteinG,
  p_carbs_g: values.carbsG,
  p_fat_g: values.fatG,
  p_fiber_g: values.fiberG,
})

const optionalText = <K extends string>(key: K, value: string | null) =>
  (value ? { [key]: value } : {}) as Partial<Record<K, string>>

export async function listFoods(
  supabase: AppSupabaseClient,
  filters: FoodFilters,
  page: number,
): Promise<{ rows: FoodAdminRow[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_list_foods', {
    ...optionalText('p_search', filters.search.trim() || null),
    ...optionalText('p_status', filters.status),
    ...optionalText('p_source', filters.source),
    p_sort: filters.sort,
    p_limit: FOODS_PAGE_SIZE,
    p_offset: page * FOODS_PAGE_SIZE,
  })
  if (error) throw error
  return {
    total: data[0]?.total_count ?? 0,
    rows: data.map((row) => ({
      ...toValues(row),
      kind: row.kind === 'SUBMISSION' ? 'SUBMISSION' : 'FOOD',
      id: row.id,
      isApproximate: row.is_approximate,
      status: row.status as FoodAdminStatus,
      source: row.source as FoodSource,
      submittedByName: row.submitted_by_name,
      notes: row.review_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    })),
  }
}

/** Shared foods with the same or a similar name. Informational only. */
export async function fetchFoodDuplicates(
  supabase: AppSupabaseClient,
  name: string,
  excludeFoodId: string | null,
): Promise<FoodDuplicate[]> {
  const { data, error } = await supabase.rpc('admin_food_duplicates', {
    p_name: name,
    ...optionalText('p_exclude_food_id', excludeFoodId),
  })
  if (error) throw error
  return data.map((row) => ({
    ...toValues(row),
    id: row.id,
    status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    isExact: row.is_exact,
  }))
}

export interface FoodFormInput {
  values: FoodSubmissionInput
  isApproximate: boolean
}

export async function createFood(
  supabase: AppSupabaseClient,
  input: FoodFormInput & { active: boolean },
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_food', {
    ...valueArgs(input.values),
    p_is_approximate: input.isApproximate,
    p_active: input.active,
  })
  if (error) throw error
  return data
}

export async function updateFood(
  supabase: AppSupabaseClient,
  input: FoodFormInput & { id: string; version: string; reason: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_food', {
    p_id: input.id,
    p_expected_updated_at: input.version,
    ...valueArgs(input.values),
    p_is_approximate: input.isApproximate,
    ...optionalText('p_reason', input.reason),
  })
  if (error) throw error
}

export async function setFoodActive(
  supabase: AppSupabaseClient,
  input: { id: string; version: string; active: boolean; reason: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_food_active', {
    p_id: input.id,
    p_expected_updated_at: input.version,
    p_active: input.active,
    ...optionalText('p_reason', input.reason),
  })
  if (error) throw error
}

/** Approves a user-created food as a shared food, with the reviewed values. */
export async function approveFoodSubmission(
  supabase: AppSupabaseClient,
  input: FoodFormInput & { id: string; version: string; notes: string | null },
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_approve_food_submission', {
    p_id: input.id,
    p_expected_updated_at: input.version,
    ...valueArgs(input.values),
    p_is_approximate: input.isApproximate,
    ...optionalText('p_notes', input.notes),
  })
  if (error) throw error
  return data
}

export async function rejectFoodSubmission(
  supabase: AppSupabaseClient,
  input: { id: string; version: string; notes: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_food_submission', {
    p_id: input.id,
    p_expected_updated_at: input.version,
    ...optionalText('p_notes', input.notes),
  })
  if (error) throw error
}

export interface BulkApprovalResult {
  id: string
  approved: boolean
  /** Why a food was skipped; null when approved. */
  message: string | null
}

/**
 * Approves several user-created foods exactly as submitted (no edits). A food
 * that cannot be approved is skipped and reported; the others still are.
 */
export async function approveFoodSubmissions(
  supabase: AppSupabaseClient,
  input: { items: readonly { id: string; version: string }[]; notes: string | null },
): Promise<BulkApprovalResult[]> {
  const { data, error } = await supabase.rpc('admin_approve_food_submissions', {
    p_items: input.items.map((item) => ({ id: item.id, expected_updated_at: item.version })),
    ...optionalText('p_notes', input.notes),
  })
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    approved: row.outcome === 'APPROVED',
    message: row.message,
  }))
}
