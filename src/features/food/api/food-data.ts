import { addDays } from '@/lib/dates/local-date'
import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

import type { FoodSubmissionInput } from '../schemas'
import type { DraftItem, FoodOption, FoodSubmission, LoggedMeal, MealCategory } from '../types'

/*
 * Food data access. Everything runs with the signed-in user's session: RLS
 * decides visibility and the record guard decides what may change. Writes
 * never send nutrition — only food ids and quantities; the database takes the
 * snapshot (spec §12).
 */

const MEAL_SELECT =
  'id, meal_date, meal_category, meal_name, is_locked, copied_from_meal_id, created_at, meal_items(id, food_item_id, food_submission_id, food_name_snapshot, quantity, unit, snapshot_calories, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g, snapshot_fiber_g, created_at, food_items(is_approximate))'

interface MealRow {
  id: string
  meal_date: string
  meal_category: MealCategory | null
  meal_name: string | null
  is_locked: boolean
  copied_from_meal_id: string | null
  created_at: string
  meal_items: {
    id: string
    food_item_id: string | null
    food_submission_id: string | null
    food_name_snapshot: string
    quantity: number
    unit: string
    snapshot_calories: number
    snapshot_protein_g: number
    snapshot_carbs_g: number
    snapshot_fat_g: number
    snapshot_fiber_g: number
    created_at: string
    food_items: { is_approximate: boolean } | null
  }[]
}

function toMeal(row: MealRow): LoggedMeal {
  return {
    id: row.id,
    date: row.meal_date,
    category: row.meal_category,
    name: row.meal_name,
    isLocked: row.is_locked,
    copiedFromMealId: row.copied_from_meal_id,
    createdAt: row.created_at,
    meal_items: [...row.meal_items]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => ({
        id: item.id,
        foodName: item.food_name_snapshot,
        quantity: item.quantity,
        unit: item.unit,
        isUserFood: item.food_submission_id !== null,
        isApproximate: item.food_items?.is_approximate ?? false,
        snapshot_calories: item.snapshot_calories,
        snapshot_protein_g: item.snapshot_protein_g,
        snapshot_carbs_g: item.snapshot_carbs_g,
        snapshot_fat_g: item.snapshot_fat_g,
        snapshot_fiber_g: item.snapshot_fiber_g,
      })),
  }
}

/** The day's meals (not deleted) with their items (not deleted), in logging order. */
export async function fetchDayMeals(
  supabase: AppSupabaseClient,
  userId: string,
  date: string,
): Promise<LoggedMeal[]> {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_SELECT)
    .eq('user_id', userId)
    .eq('meal_date', date)
    .eq('is_deleted', false)
    .eq('meal_items.is_deleted', false)
    .order('created_at')
  if (error) throw error
  return (data as MealRow[]).map(toMeal).filter((meal) => meal.meal_items.length > 0)
}

/** Recent meals to copy from: the 14 days up to and including `date`. */
export async function fetchCopyCandidates(
  supabase: AppSupabaseClient,
  userId: string,
  date: string,
): Promise<LoggedMeal[]> {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_SELECT)
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .eq('meal_items.is_deleted', false)
    .gte('meal_date', addDays(date, -14))
    .lte('meal_date', date)
    .order('meal_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data as MealRow[]).map(toMeal).filter((meal) => meal.meal_items.length > 0)
}

type FoodRpcRow = Database['public']['Functions']['food_usage']['Returns'][number]

function toFoodOption(row: FoodRpcRow): FoodOption {
  return {
    source: row.source === 'SUBMISSION' ? 'SUBMISSION' : 'FOOD',
    id: row.id,
    name: row.name,
    servingQuantity: row.serving_quantity,
    servingUnit: row.serving_unit,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    isApproximate: row.is_approximate,
    reviewStatus: row.review_status,
    useCount: row.use_count,
    lastUsed: row.last_used,
  }
}

/** Server-side ranked search (exact → recent → frequent → broader match). */
export async function searchFoods(
  supabase: AppSupabaseClient,
  query: string,
  limit = 20,
): Promise<FoodOption[]> {
  const { data, error } = await supabase.rpc('search_foods', { p_query: query, p_limit: limit })
  if (error) throw error
  return data.map(toFoodOption)
}

/** The caller's recently or frequently logged foods (merges followed). */
export async function fetchFoodUsage(
  supabase: AppSupabaseClient,
  order: 'recent' | 'frequent',
  limit = 10,
): Promise<FoodOption[]> {
  const { data, error } = await supabase.rpc('food_usage', { p_order: order, p_limit: limit })
  if (error) throw error
  return data.map(toFoodOption)
}

function itemPayload(items: readonly DraftItem[]) {
  return items.map((item) =>
    item.food.source === 'FOOD'
      ? { food_item_id: item.food.id, quantity: item.quantity }
      : { food_submission_id: item.food.id, quantity: item.quantity },
  )
}

/** A new meal (today, or a missing past meal — late entry). Returns the meal id. */
export async function logMeal(
  supabase: AppSupabaseClient,
  input: { date: string; category: MealCategory | null; items: readonly DraftItem[] },
): Promise<string> {
  const { data, error } = await supabase.rpc('log_meal', {
    p_meal_date: input.date,
    p_items: itemPayload(input.items),
    ...(input.category ? { p_meal_category: input.category } : {}),
  })
  if (error) throw error
  return data
}

/** Appends foods to one of today's editable meals. */
export async function addItemsToMeal(
  supabase: AppSupabaseClient,
  input: { mealId: string; items: readonly DraftItem[] },
): Promise<void> {
  const { error } = await supabase.rpc('add_meal_items', {
    p_meal_id: input.mealId,
    p_items: itemPayload(input.items),
  })
  if (error) throw error
}

/** Quantity change; the database rescales the snapshot. */
export async function updateItemQuantity(
  supabase: AppSupabaseClient,
  input: { itemId: string; quantity: number },
): Promise<void> {
  const { error } = await supabase
    .from('meal_items')
    .update({ quantity: input.quantity })
    .eq('id', input.itemId)
  if (error) throw error
}

export async function deleteItem(supabase: AppSupabaseClient, itemId: string): Promise<void> {
  const { error } = await supabase.from('meal_items').update({ is_deleted: true }).eq('id', itemId)
  if (error) throw error
}

export async function deleteMeal(supabase: AppSupabaseClient, mealId: string): Promise<void> {
  const { error } = await supabase.from('meals').update({ is_deleted: true }).eq('id', mealId)
  if (error) throw error
}

export async function updateMealCategory(
  supabase: AppSupabaseClient,
  input: { mealId: string; category: MealCategory | null },
): Promise<void> {
  const { error } = await supabase
    .from('meals')
    .update({ meal_category: input.category })
    .eq('id', input.mealId)
  if (error) throw error
}

/** Copies a meal into `date` as a new, independent meal. */
export async function copyMeal(
  supabase: AppSupabaseClient,
  input: { mealId: string; date: string },
): Promise<string> {
  const { data, error } = await supabase.rpc('copy_meal', {
    p_source_meal_id: input.mealId,
    p_target_date: input.date,
  })
  if (error) throw error
  return data
}

export async function fetchMySubmissions(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<FoodSubmission[]> {
  const { data, error } = await supabase
    .from('food_submissions')
    .select(
      'id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g, status, created_at',
    )
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    servingQuantity: row.serving_quantity,
    servingUnit: row.serving_unit,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    status: row.status,
    createdAt: row.created_at,
  }))
}

/** A new food for review (PENDING_REVIEW). Usable by its submitter right away. */
export async function submitFood(
  supabase: AppSupabaseClient,
  userId: string,
  input: FoodSubmissionInput,
): Promise<FoodOption> {
  const { data, error } = await supabase
    .from('food_submissions')
    .insert({
      submitted_by: userId,
      name: input.name,
      serving_quantity: input.servingQuantity,
      serving_unit: input.servingUnit,
      calories: input.calories,
      protein_g: input.proteinG,
      carbs_g: input.carbsG,
      fat_g: input.fatG,
      fiber_g: input.fiberG,
    })
    .select(
      'id, name, serving_quantity, serving_unit, calories, protein_g, carbs_g, fat_g, fiber_g, status',
    )
    .single()
  if (error) throw error
  return {
    source: 'SUBMISSION',
    id: data.id,
    name: data.name,
    servingQuantity: data.serving_quantity,
    servingUnit: data.serving_unit,
    calories: data.calories,
    proteinG: data.protein_g,
    carbsG: data.carbs_g,
    fatG: data.fat_g,
    fiberG: data.fiber_g,
    isApproximate: false,
    reviewStatus: data.status,
    useCount: 0,
    lastUsed: null,
  }
}
