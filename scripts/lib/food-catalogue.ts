import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Database } from '../../src/types/database.ts'

/*
 * The starter food catalogue (supabase/seeds/starter-foods.json) and the logic
 * that loads it. Used by scripts/seed-foods.ts; never applied automatically.
 */

const amount = z.number().nonnegative().max(2000)

export const catalogueFoodSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    serving_quantity: z.number().positive().max(1000),
    // Same rule as the database's food_items_unit_format check.
    serving_unit: z.string().regex(/^[a-z][a-z ]{0,19}$/),
    calories: amount,
    protein_g: amount,
    carbs_g: amount,
    fat_g: amount,
    fiber_g: amount,
  })
  .refine((food) => food.fiber_g <= food.carbs_g + 0.5 || food.carbs_g === 0, {
    error: 'fiber cannot exceed carbohydrates',
  })

export type CatalogueFood = z.infer<typeof catalogueFoodSchema>

export const catalogueSchema = z.object({
  _about: z.string(),
  foods: z.array(catalogueFoodSchema).min(1),
})

/** Lower-case, single-spaced: how two food names are compared. */
export const normalizeFoodName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Energy implied by the macros (4/4/9 kcal per gram). A catalogue entry whose
 * calories are far from this is almost certainly a typing error.
 */
export function macroEnergy(food: Pick<CatalogueFood, 'protein_g' | 'carbs_g' | 'fat_g'>): number {
  return 4 * food.protein_g + 4 * food.carbs_g + 9 * food.fat_g
}

export function inconsistentFoods(foods: readonly CatalogueFood[]): string[] {
  return foods
    .filter(
      (food) => Math.abs(food.calories - macroEnergy(food)) > Math.max(25, 0.2 * food.calories),
    )
    .map((food) => food.name)
}

/** Catalogue entries not yet in the database, compared by normalized name. */
export function foodsToAdd(
  catalogue: readonly CatalogueFood[],
  existingNames: readonly string[],
): CatalogueFood[] {
  const existing = new Set(existingNames.map(normalizeFoodName))
  const seen = new Set<string>()
  return catalogue.filter((food) => {
    const key = normalizeFoodName(food.name)
    if (existing.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface SeedResult {
  added: string[]
  skipped: number
}

/**
 * Adds the missing catalogue foods as shared, approximate foods. Safe to run
 * again: foods already present (by name) are left untouched, never updated,
 * so later admin edits are not overwritten. Requires the service role.
 */
export async function seedFoodCatalogue(
  db: SupabaseClient<Database>,
  catalogue: readonly CatalogueFood[],
  options: { dryRun?: boolean } = {},
): Promise<SeedResult> {
  const existing = await db.from('food_items').select('name').eq('is_deleted', false)
  if (existing.error) throw new Error(`Could not read foods: ${existing.error.message}`)
  const missing = foodsToAdd(
    catalogue,
    existing.data.map((row) => row.name),
  )
  const result: SeedResult = {
    added: missing.map((food) => food.name),
    skipped: catalogue.length - missing.length,
  }
  if (options.dryRun || missing.length === 0) return result

  const inserted = await db
    .from('food_items')
    .insert(missing.map((food) => ({ ...food, is_approximate: true })))
    .select('id')
  if (inserted.error) throw new Error(`Could not add foods: ${inserted.error.message}`)
  if (inserted.data.length !== missing.length) {
    throw new Error(
      `Expected ${String(missing.length)} foods, added ${String(inserted.data.length)}`,
    )
  }
  return result
}
