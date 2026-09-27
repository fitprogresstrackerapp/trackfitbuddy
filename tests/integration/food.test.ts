/**
 * Food against the real database: search visibility and ranking, logging,
 * snapshots, editing and locking, late entry, copy, user foods, and RLS
 * isolation. Runs through the same data functions the app uses, signed in as
 * normal users (anon key + session, RLS applies).
 */
import { beforeAll, describe, expect, it } from 'vitest'

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
} from '@/features/food/api/food-data'
import type { DraftItem, FoodOption } from '@/features/food/types'
import { fetchHomeNutrition } from '@/features/home/api/home-data'
import { sumNutrition } from '@/features/nutrition/lib/nutrition'
import { addDays } from '@/lib/dates/local-date'

import { seedFoods, seedPastMeal, type SeededFoods } from './food-fixtures.ts'
import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must, TODAY } from './home-fixtures.ts'

/**
 * A draft item whose client-side nutrition is deliberately absurd: the
 * database must ignore it and take the snapshot from the food itself.
 */
function draft(id: string, quantity: number, source: FoodOption['source'] = 'FOOD'): DraftItem {
  return {
    key: `${id}-${String(quantity)}`,
    quantity,
    food: {
      source,
      id,
      name: 'client name',
      servingQuantity: 1,
      servingUnit: 'client unit',
      calories: 99_999,
      proteinG: 9_999,
      carbsG: 9_999,
      fatG: 9_999,
      fiberG: 9_999,
      isApproximate: false,
      reviewStatus: null,
      useCount: 0,
      lastUsed: null,
    },
  }
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('Food', () => {
  const admin = adminClient()
  let foods: SeededFoods
  let owner: { userId: string; phone: string; pin: string }
  let other: { userId: string; phone: string; pin: string }
  let ownerClient: BrowserClient
  let otherClient: BrowserClient
  let pastMealId: string

  beforeAll(async () => {
    foods = await seedFoods(admin)
    owner = await createUser('1234')
    other = await createUser('4321')
    await completeProfile(admin, owner.userId)
    await completeProfile(admin, other.userId)
    pastMealId = await seedPastMeal(admin, owner.userId, addDays(TODAY, -3), foods.chicken.id, 150)
    ownerClient = await signedInClient(owner.phone, owner.pin)
    otherClient = await signedInClient(other.phone, other.pin)
  })

  describe('search', () => {
    it('finds approved shared foods with their per-serving values and source', async () => {
      const results = await searchFoods(ownerClient, `banana ${foods.tag}`)
      expect(results[0]).toMatchObject({
        source: 'FOOD',
        id: foods.banana.id,
        servingQuantity: 1,
        servingUnit: 'piece',
        calories: 105,
        proteinG: 1.3,
      })
    })

    it('returns the caller’s own pending food but never another user’s', async () => {
      const mine = await submitFood(ownerClient, owner.userId, {
        name: `Owner secret dal ${foods.tag}`,
        servingQuantity: 1,
        servingUnit: 'bowl',
        calories: 200,
        proteinG: 10,
        carbsG: 25,
        fatG: 6,
        fiberG: 5,
      })
      const ownerResults = await searchFoods(ownerClient, `secret dal ${foods.tag}`)
      expect(ownerResults.map((food) => food.id)).toContain(mine.id)
      expect(ownerResults.find((food) => food.id === mine.id)?.reviewStatus).toBe('PENDING_REVIEW')

      const otherResults = await searchFoods(otherClient, `secret dal ${foods.tag}`)
      expect(otherResults.map((food) => food.id)).not.toContain(mine.id)
      const direct = await otherClient.from('food_submissions').select('id').eq('id', mine.id)
      expect(direct.data).toEqual([])
    })

    it('ranks a food the user has logged above an equally good match', async () => {
      // "chicken <tag>" matches Chicken breast and Chicken curry equally (both prefix matches).
      const before = await searchFoods(otherClient, `chicken ${foods.tag}`)
      expect(before.map((food) => food.id)).toEqual(
        expect.arrayContaining([foods.chicken.id, foods.curry.id]),
      )
      await logMeal(otherClient, {
        date: TODAY,
        category: null,
        items: [draft(foods.curry.id, 1)],
      })
      const after = await searchFoods(otherClient, `chicken ${foods.tag}`)
      const ranked = after.filter((food) => [foods.chicken.id, foods.curry.id].includes(food.id))
      expect(ranked[0]?.id).toBe(foods.curry.id)
    })

    it('lists recent and frequent foods from actual use only', async () => {
      await logMeal(otherClient, {
        date: TODAY,
        category: null,
        items: [draft(foods.banana.id, 1)],
      })
      await logMeal(otherClient, {
        date: TODAY,
        category: null,
        items: [draft(foods.banana.id, 2)],
      })
      const recent = await fetchFoodUsage(otherClient, 'recent')
      expect(recent[0]?.id).toBe(foods.banana.id)
      const frequent = await fetchFoodUsage(otherClient, 'frequent')
      expect(frequent.map((food) => food.id).slice(0, 2)).toEqual([foods.banana.id, foods.curry.id])
      expect(frequent[0]?.useCount).toBe(2)
      // Nothing from other users' logs.
      expect(frequent.map((food) => food.id)).not.toContain(foods.chicken.id)
    })
  })

  describe('logging and editing today', () => {
    let lunchId: string

    it('creates a new meal; nutrition comes from the database, not the client', async () => {
      lunchId = await logMeal(ownerClient, {
        date: TODAY,
        category: 'LUNCH',
        items: [draft(foods.chicken.id, 200), draft(foods.banana.id, 2)],
      })
      const [meal] = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(meal?.id).toBe(lunchId)
      expect(meal?.category).toBe('LUNCH')
      expect(meal?.isLocked).toBe(false)
      expect(
        meal?.meal_items.map((item) => [
          item.foodName,
          item.quantity,
          item.unit,
          item.snapshot_calories,
          item.snapshot_protein_g,
        ]),
      ).toEqual([
        [foods.chicken.name, 200, 'g', 330, 62],
        [foods.banana.name, 2, 'piece', 210, 2.6],
      ])
    })

    it('adds food to the existing meal instead of creating another', async () => {
      await addItemsToMeal(ownerClient, { mealId: lunchId, items: [draft(foods.idli.id, 2)] })
      const meals = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(meals).toHaveLength(1)
      expect(meals[0]?.meal_items).toHaveLength(3)
      expect(meals[0]?.meal_items[2]).toMatchObject({
        foodName: foods.idli.name,
        isApproximate: true,
      })
    })

    it('daily totals are the sum of snapshots and ignore later master changes', async () => {
      await must(
        admin.from('food_items').update({ calories: 999 }).eq('id', foods.idli.id).select('id'),
      )
      const totals = sumNutrition(await fetchDayMeals(ownerClient, owner.userId, TODAY))
      expect(totals).toMatchObject({ calories: 656, proteinG: 68.6, mealCount: 1, itemCount: 3 })
      await must(
        admin.from('food_items').update({ calories: 58 }).eq('id', foods.idli.id).select('id'),
      )
    })

    it('quantity change on an editable item rescales its snapshot', async () => {
      const [meal] = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      const chicken = meal?.meal_items.find((item) => item.unit === 'g')
      if (!chicken) throw new Error('chicken item missing')
      await updateItemQuantity(ownerClient, { itemId: chicken.id, quantity: 150 })
      const [after] = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(after?.meal_items.find((item) => item.id === chicken.id)).toMatchObject({
        quantity: 150,
        snapshot_calories: 247.5,
        snapshot_protein_g: 46.5,
      })
    })

    it('a client cannot set snapshot values directly', async () => {
      const [meal] = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      const item = meal?.meal_items[0]
      if (!item) throw new Error('item missing')
      const { error } = await ownerClient
        .from('meal_items')
        .update({ snapshot_calories: 1 })
        .eq('id', item.id)
      expect(error?.code).toBe('42501')
    })

    it('rejects invalid quantities and future dates', async () => {
      await expectError(
        logMeal(ownerClient, { date: TODAY, category: null, items: [draft(foods.banana.id, 0)] }),
        '23514',
      )
      await expectError(
        logMeal(ownerClient, { date: TODAY, category: null, items: [draft(foods.banana.id, -1)] }),
        '23514',
      )
      await expectError(
        logMeal(ownerClient, {
          date: addDays(TODAY, 1),
          category: null,
          items: [draft(foods.banana.id, 1)],
        }),
        '22023',
      )
    })

    it('deleted items and deleted meals are excluded', async () => {
      const snackId = await logMeal(ownerClient, {
        date: TODAY,
        category: 'SNACKS',
        items: [draft(foods.banana.id, 1), draft(foods.idli.id, 1)],
      })
      let meals = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      const snack = meals.find((meal) => meal.id === snackId)
      const idli = snack?.meal_items.find((item) => item.foodName === foods.idli.name)
      if (!idli) throw new Error('idli missing')

      await deleteItem(ownerClient, idli.id)
      meals = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(meals.find((meal) => meal.id === snackId)?.meal_items).toHaveLength(1)

      await deleteMeal(ownerClient, snackId)
      meals = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(meals.map((meal) => meal.id)).not.toContain(snackId)
      // Soft deletion: the row still exists for audit, just flagged.
      const row = await must(admin.from('meals').select('is_deleted').eq('id', snackId).single())
      expect(row.is_deleted).toBe(true)
    })

    it('Home reads the same totals after a Food change', async () => {
      const foodTotals = sumNutrition(await fetchDayMeals(ownerClient, owner.userId, TODAY))
      const home = await fetchHomeNutrition(ownerClient, owner.userId, TODAY)
      expect(home.totals).toEqual(foodTotals)
    })
  })

  describe('locked history and late entry', () => {
    it('shows an existing past meal as locked and keeps it read-only', async () => {
      const past = addDays(TODAY, -3)
      const [meal] = await fetchDayMeals(ownerClient, owner.userId, past)
      expect(meal).toMatchObject({ id: pastMealId, isLocked: true })
      const item = meal?.meal_items[0]
      if (!item) throw new Error('item missing')
      expect(item.snapshot_calories).toBe(247.5)

      await expectError(updateItemQuantity(ownerClient, { itemId: item.id, quantity: 50 }), '42501')
      await expectError(deleteItem(ownerClient, item.id), '42501')
      await expectError(deleteMeal(ownerClient, pastMealId), '42501')
      await expectError(
        addItemsToMeal(ownerClient, { mealId: pastMealId, items: [draft(foods.banana.id, 1)] }),
        '42501',
      )
      const { error: unlock } = await ownerClient
        .from('meals')
        .update({ is_locked: false })
        .eq('id', pastMealId)
      expect(unlock?.code).toBe('42501')

      const [after] = await fetchDayMeals(ownerClient, owner.userId, past)
      expect(after?.meal_items).toHaveLength(1)
      expect(after?.meal_items[0]?.quantity).toBe(150)
    })

    it('direct inserts into a past day are still rejected', async () => {
      const { error } = await ownerClient
        .from('meals')
        .insert({ user_id: owner.userId, meal_date: addDays(TODAY, -2) })
      expect(error?.code).toBe('42501')
    })

    it('a missing past meal can be added once, and is locked from then on', async () => {
      const day = addDays(TODAY, -2)
      const mealId = await logMeal(ownerClient, {
        date: day,
        category: 'BREAKFAST',
        items: [draft(foods.idli.id, 3)],
      })
      const [meal] = await fetchDayMeals(ownerClient, owner.userId, day)
      expect(meal).toMatchObject({ id: mealId, category: 'BREAKFAST' })
      expect(meal?.meal_items[0]?.snapshot_calories).toBe(174)

      const item = meal?.meal_items[0]
      if (!item) throw new Error('item missing')
      await expectError(updateItemQuantity(ownerClient, { itemId: item.id, quantity: 1 }), '42501')
      await expectError(deleteMeal(ownerClient, mealId), '42501')
      await expectError(
        addItemsToMeal(ownerClient, { mealId, items: [draft(foods.banana.id, 1)] }),
        '42501',
      )
    })

    it('late entry is limited to the last 90 days', async () => {
      await expectError(
        logMeal(ownerClient, {
          date: addDays(TODAY, -91),
          category: null,
          items: [draft(foods.banana.id, 1)],
        }),
        '22023',
      )
    })
  })

  describe('copy meal', () => {
    it('copies a locked past meal into today as a new, independent, editable meal', async () => {
      const copyId = await copyMeal(ownerClient, { mealId: pastMealId, date: TODAY })
      expect(copyId).not.toBe(pastMealId)

      const copy = (await fetchDayMeals(ownerClient, owner.userId, TODAY)).find(
        (meal) => meal.id === copyId,
      )
      expect(copy).toMatchObject({
        category: 'DINNER',
        isLocked: false,
        copiedFromMealId: pastMealId,
      })
      expect(
        copy?.meal_items.map((item) => [item.foodName, item.quantity, item.snapshot_calories]),
      ).toEqual([[foods.chicken.name, 150, 247.5]])

      const item = copy?.meal_items[0]
      if (!item) throw new Error('copied item missing')
      await updateItemQuantity(ownerClient, { itemId: item.id, quantity: 300 })

      const [original] = await fetchDayMeals(ownerClient, owner.userId, addDays(TODAY, -3))
      expect(original).toMatchObject({ id: pastMealId, isLocked: true })
      expect(original?.meal_items[0]).toMatchObject({ quantity: 150, snapshot_calories: 247.5 })
    })

    it('offers recent meals as copy candidates, including locked ones', async () => {
      const candidates = await fetchCopyCandidates(ownerClient, owner.userId, TODAY)
      expect(candidates.map((meal) => meal.id)).toContain(pastMealId)
      expect(candidates.every((meal) => meal.meal_items.length > 0)).toBe(true)
    })

    it('cannot copy another user’s meal or into the future', async () => {
      await expectError(copyMeal(otherClient, { mealId: pastMealId, date: TODAY }), 'P0002')
      await expectError(
        copyMeal(ownerClient, { mealId: pastMealId, date: addDays(TODAY, 1) }),
        '22023',
      )
    })
  })

  describe('user foods', () => {
    it('submits a food as pending review, usable by its owner only', async () => {
      const food = await submitFood(ownerClient, owner.userId, {
        name: `Home poha ${foods.tag}`,
        servingQuantity: 1,
        servingUnit: 'plate',
        calories: 250,
        proteinG: 5,
        carbsG: 45,
        fatG: 6,
        fiberG: 3,
      })
      expect(food).toMatchObject({ source: 'SUBMISSION', reviewStatus: 'PENDING_REVIEW' })
      const mine = await fetchMySubmissions(ownerClient, owner.userId)
      expect(mine.find((entry) => entry.id === food.id)?.status).toBe('PENDING_REVIEW')

      const mealId = await logMeal(ownerClient, {
        date: TODAY,
        category: null,
        items: [draft(food.id, 2, 'SUBMISSION')],
      })
      const meal = (await fetchDayMeals(ownerClient, owner.userId, TODAY)).find(
        (entry) => entry.id === mealId,
      )
      expect(meal?.meal_items[0]).toMatchObject({ isUserFood: true, snapshot_calories: 500 })

      // Another user cannot log it.
      await expectError(
        logMeal(otherClient, {
          date: TODAY,
          category: null,
          items: [draft(food.id, 1, 'SUBMISSION')],
        }),
        '23503',
      )
    })

    it('rejects negative nutrition and cannot self-approve', async () => {
      await expectError(
        submitFood(ownerClient, owner.userId, {
          name: `Bad food ${foods.tag}`,
          servingQuantity: 1,
          servingUnit: 'plate',
          calories: -5,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
          fiberG: 1,
        }),
        '23514',
      )
      const { error } = await ownerClient.from('food_submissions').insert({
        submitted_by: owner.userId,
        name: `Self approved ${foods.tag}`,
        serving_quantity: 1,
        serving_unit: 'plate',
        calories: 1,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 1,
        fiber_g: 1,
        status: 'APPROVED',
      })
      expect(error).not.toBeNull()
    })

    it('a similar name is only a warning: nothing is merged or overwritten', async () => {
      const similar = await searchFoods(ownerClient, `chicken curry ${foods.tag}`)
      expect(similar[0]?.id).toBe(foods.curry.id)
      const food = await submitFood(ownerClient, owner.userId, {
        name: `Chicken curry ${foods.tag}`,
        servingQuantity: 1,
        servingUnit: 'bowl',
        calories: 400,
        proteinG: 20,
        carbsG: 12,
        fatG: 28,
        fiberG: 2,
      })
      expect(food.id).not.toBe(foods.curry.id)
      const shared = await must(
        admin
          .from('food_items')
          .select('calories, is_deleted, merged_into_food_id')
          .eq('id', foods.curry.id)
          .single(),
      )
      expect(shared).toEqual({ calories: 320, is_deleted: false, merged_into_food_id: null })
    })
  })

  describe('isolation', () => {
    it('another user cannot read or change the owner’s meals', async () => {
      expect(await fetchDayMeals(otherClient, owner.userId, TODAY)).toEqual([])
      expect(await fetchDayMeals(otherClient, owner.userId, addDays(TODAY, -3))).toEqual([])

      const [ownerMeal] = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      if (!ownerMeal) throw new Error('owner meal missing')
      const { data } = await otherClient
        .from('meals')
        .update({ is_deleted: true })
        .eq('id', ownerMeal.id)
        .select('id')
      expect(data).toEqual([])
      await expectError(
        addItemsToMeal(otherClient, { mealId: ownerMeal.id, items: [draft(foods.banana.id, 1)] }),
        'P0002',
      )
      const still = await fetchDayMeals(ownerClient, owner.userId, TODAY)
      expect(still.map((meal) => meal.id)).toContain(ownerMeal.id)
    })
  })
})
