/*
 * Plausibility of a food's values. Shared by the starter-catalogue loader
 * (scripts/lib/food-catalogue.ts, where a mismatch stops the load) and the
 * admin food form (where it asks the admin to look again). Nothing here ever
 * changes a value. Relative imports only: this file is also read by Node.
 */

interface Macros {
  protein_g: number
  carbs_g: number
  fat_g: number
}

/** Energy implied by the macros (4 / 4 / 9 kcal per gram). */
export function macroEnergy(food: Macros): number {
  return 4 * food.protein_g + 4 * food.carbs_g + 9 * food.fat_g
}

/**
 * True when the calories are far from what the macros imply: by more than
 * 25 kcal and more than 20%. Almost always a typing error (a gram value in the
 * wrong field, a per-100 g figure for a whole serving).
 */
export function hasEnergyMismatch(food: Macros & { calories: number }): boolean {
  return Math.abs(food.calories - macroEnergy(food)) > Math.max(25, 0.2 * food.calories)
}
