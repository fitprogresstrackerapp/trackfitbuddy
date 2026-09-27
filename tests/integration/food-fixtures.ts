/**
 * Seed data for Food tests (integration and browser). Service role only —
 * local stack only. Food names carry a per-run tag so runs never collide.
 */
import type { Admin } from './home-fixtures.ts'
import { must } from './home-fixtures.ts'

export interface SeededFoods {
  tag: string
  chicken: { id: string; name: string }
  curry: { id: string; name: string }
  banana: { id: string; name: string }
  idli: { id: string; name: string }
}

export function uniqueTag(): string {
  // Letters only, so names stay searchable as words (e.g. "Banana qzkd").
  return Array.from({ length: 5 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('')
}

/** Four shared foods; Idli is flagged approximate. */
export async function seedFoods(admin: Admin, tag = uniqueTag()): Promise<SeededFoods> {
  const rows = await must(
    admin
      .from('food_items')
      .insert([
        {
          name: `Chicken breast ${tag}`,
          serving_quantity: 100,
          serving_unit: 'g',
          calories: 165,
          protein_g: 31,
          carbs_g: 0,
          fat_g: 3.6,
          fiber_g: 0,
          is_approximate: false,
        },
        {
          name: `Chicken curry ${tag}`,
          serving_quantity: 1,
          serving_unit: 'bowl',
          calories: 320,
          protein_g: 24,
          carbs_g: 10,
          fat_g: 20,
          fiber_g: 2,
          is_approximate: false,
        },
        {
          name: `Banana ${tag}`,
          serving_quantity: 1,
          serving_unit: 'piece',
          calories: 105,
          protein_g: 1.3,
          carbs_g: 27,
          fat_g: 0.4,
          fiber_g: 3.1,
          is_approximate: false,
        },
        {
          name: `Idli ${tag}`,
          serving_quantity: 1,
          serving_unit: 'piece',
          calories: 58,
          protein_g: 2,
          carbs_g: 12,
          fat_g: 0.4,
          fiber_g: 0.8,
          is_approximate: true,
        },
      ])
      .select('id, name'),
  )
  const find = (prefix: string) => {
    const row = rows.find((entry) => entry.name.startsWith(prefix))
    if (!row) throw new Error(`food ${prefix} not created`)
    return row
  }
  return {
    tag,
    chicken: find('Chicken breast'),
    curry: find('Chicken curry'),
    banana: find('Banana'),
    idli: find('Idli'),
  }
}

/**
 * A meal on a past day, as it would exist after the day ended: created with
 * the service role (users cannot write past days directly) and locked.
 */
export async function seedPastMeal(
  admin: Admin,
  userId: string,
  date: string,
  foodId: string,
  quantity: number,
): Promise<string> {
  const meal = await must(
    admin
      .from('meals')
      .insert({ user_id: userId, meal_date: date, meal_category: 'DINNER' })
      .select('id')
      .single(),
  )
  await must(
    admin
      .from('meal_items')
      .insert({
        meal_id: meal.id,
        user_id: userId,
        food_item_id: foodId,
        quantity,
        // Required by the insert type; the snapshot trigger overwrites them.
        unit: '',
        food_name_snapshot: '',
        snapshot_calories: 0,
        snapshot_protein_g: 0,
        snapshot_carbs_g: 0,
        snapshot_fat_g: 0,
        snapshot_fiber_g: 0,
      })
      .select('id'),
  )
  await must(admin.from('meals').update({ is_locked: true }).eq('id', meal.id).select('id'))
  return meal.id
}
