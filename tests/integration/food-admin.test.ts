/**
 * Admin Food Database against the real local stack: the admin functions, RLS,
 * the review of user-created foods, and the user's Food flow around them.
 * Admins and users act through the app's own data functions (anon key +
 * session); direct calls prove the server refuses what the UI never offers.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  approveFoodSubmission,
  createFood,
  fetchFoodDuplicates,
  listFoods,
  rejectFoodSubmission,
  setFoodActive,
  updateFood,
  type FoodAdminRow,
  type FoodFilters,
} from '@/features/admin/api/food-admin-data'
import {
  copyMeal,
  fetchDayMeals,
  fetchFoodUsage,
  fetchMySubmissions,
  logMeal,
  searchFoods,
  submitFood,
} from '@/features/food/api/food-data'
import type { FoodSubmissionInput } from '@/features/food/schemas'
import type { DraftItem, FoodOption } from '@/features/food/types'

import { uniqueTag } from './food-fixtures.ts'
import {
  adminClient,
  browserClient,
  createUser,
  signedInClient,
  type BrowserClient,
} from './helpers.ts'
import { completeProfile, TODAY } from './home-fixtures.ts'

const tag = uniqueTag()
const filters = (overrides: Partial<FoodFilters> = {}): FoodFilters => ({
  search: tag,
  status: null,
  source: null,
  sort: 'NAME',
  ...overrides,
})
const values = (
  name: string,
  overrides: Partial<FoodSubmissionInput> = {},
): FoodSubmissionInput => ({
  name,
  servingQuantity: 100,
  servingUnit: 'g',
  calories: 200,
  proteinG: 10,
  carbsG: 25,
  fatG: 6,
  fiberG: 3,
  ...overrides,
})
/** A food from a search result, which must be there. */
function draft(food: FoodOption | undefined, quantity: number): DraftItem {
  if (!food) throw new Error('food not found')
  return { key: `${food.id}-${String(quantity)}`, food, quantity }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'OK'
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNKNOWN'
  }
}

async function row(admin: BrowserClient, name: string, kind: FoodAdminRow['kind'] = 'FOOD') {
  const { rows } = await listFoods(admin, filters({ search: name }), 0)
  const found = rows.find((entry) => entry.name === name && entry.kind === kind)
  if (!found) throw new Error(`${name} not listed`)
  return found
}

describe('Admin Food Database', () => {
  let admin: BrowserClient
  let superAdmin: BrowserClient
  let manager: BrowserClient
  let user: BrowserClient
  let userId: string
  let other: BrowserClient
  let otherId: string

  beforeAll(async () => {
    const service = adminClient()
    const a = await createUser('1111', ['ADMIN'])
    const s = await createUser('2222', ['SUPER_ADMIN'])
    const m = await createUser('3333', ['MANAGER'])
    const u = await createUser('4444')
    const o = await createUser('5555')
    userId = u.userId
    otherId = o.userId
    for (const id of [u.userId, o.userId]) await completeProfile(service, id)
    admin = await signedInClient(a.phone, a.pin)
    superAdmin = await signedInClient(s.phone, s.pin)
    manager = await signedInClient(m.phone, m.pin)
    user = await signedInClient(u.phone, u.pin)
    other = await signedInClient(o.phone, o.pin)
  })

  describe('authorization', () => {
    it('a normal user, a manager and an anonymous caller cannot use any admin operation', async () => {
      const anon = browserClient()
      for (const client of [user, manager, anon]) {
        expect(await codeOf(listFoods(client, filters(), 0))).toMatch(/42501|PGRST202|42883/)
        expect(
          await codeOf(
            createFood(client, {
              values: values(`Hack ${tag}`),
              isApproximate: true,
              active: true,
            }),
          ),
        ).toMatch(/42501|PGRST202|42883/)
        expect(await codeOf(fetchFoodDuplicates(client, 'rice', null))).toMatch(
          /42501|PGRST202|42883/,
        )
      }
      // Direct table writes are refused or change nothing.
      const insert = await user.from('food_items').insert({
        name: `Direct ${tag}`,
        serving_quantity: 1,
        serving_unit: 'g',
        calories: 1,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        fiber_g: 0,
      })
      expect(insert.error?.code).toBe('42501')
    })

    it('ADMIN and SUPER_ADMIN can manage foods', async () => {
      await createFood(admin, {
        values: values(`Admin dal ${tag}`),
        isApproximate: true,
        active: true,
      })
      await createFood(superAdmin, {
        values: values(`Super dal ${tag}`),
        isApproximate: false,
        active: true,
      })
      const { rows } = await listFoods(admin, filters({ search: `dal ${tag}` }), 0)
      expect(rows.map((entry) => [entry.name, entry.source, entry.status])).toEqual([
        [`Admin dal ${tag}`, 'ADMIN', 'ACTIVE'],
        [`Super dal ${tag}`, 'ADMIN', 'ACTIVE'],
      ])
    })
  })

  describe('catalogue', () => {
    it('validates values and refuses duplicate names, without changing anything', async () => {
      expect(
        await codeOf(
          createFood(admin, {
            values: values(`ADMIN  DAL ${tag}!`),
            isApproximate: true,
            active: true,
          }),
        ),
      ).toBe('22023')
      expect(
        await codeOf(
          createFood(admin, {
            values: values(`Bad ${tag}`, { proteinG: -1 }),
            isApproximate: true,
            active: true,
          }),
        ),
      ).toBe('22023')
      expect(
        await codeOf(
          createFood(admin, {
            values: values(`Bad ${tag}`, { servingUnit: 'Kg!' }),
            isApproximate: true,
            active: true,
          }),
        ),
      ).toBe('22023')
      const { rows } = await listFoods(admin, filters({ search: `bad ${tag}` }), 0)
      expect(rows.filter((entry) => entry.name.startsWith('Bad'))).toHaveLength(0)
    })

    it('lists, filters, sorts and pages on the server', async () => {
      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        await createFood(admin, {
          values: values(`${name} soup ${tag}`),
          isApproximate: true,
          active: name !== 'Gamma',
        })
      }
      const byName = await listFoods(admin, filters({ search: `soup ${tag}` }), 0)
      expect(byName.rows.map((entry) => entry.name.split(' ')[0])).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ])
      expect(byName.total).toBe(3)
      const newest = await listFoods(admin, filters({ search: `soup ${tag}`, sort: 'NEWEST' }), 0)
      expect(newest.rows[0]?.name).toBe(`Gamma soup ${tag}`)
      const inactive = await listFoods(
        admin,
        filters({ search: `soup ${tag}`, status: 'INACTIVE' }),
        0,
      )
      expect(inactive.rows.map((entry) => entry.name)).toEqual([`Gamma soup ${tag}`])
      const catalogue = await listFoods(
        admin,
        { search: '', status: null, source: null, sort: 'NAME' },
        0,
      )
      expect(catalogue.rows.length).toBeLessThanOrEqual(25)
    })

    it('an inactive food is hidden from users, kept for history, and can be activated again', async () => {
      const food = await row(admin, `Beta soup ${tag}`)
      const [found] = await searchFoods(user, `Beta soup ${tag}`)
      expect(found?.id).toBe(food.id)
      const mealId = await logMeal(user, {
        date: TODAY,
        category: null,
        items: [draft(found, 200)],
      })

      await setFoodActive(admin, {
        id: food.id,
        version: food.updatedAt,
        active: false,
        reason: 'Duplicate',
      })
      expect((await searchFoods(user, `Beta soup ${tag}`)).map((entry) => entry.id)).not.toContain(
        food.id,
      )
      expect(
        await codeOf(logMeal(user, { date: TODAY, category: null, items: [draft(found, 100)] })),
      ).toBe('23503')
      const meal = (await fetchDayMeals(user, userId, TODAY)).find((entry) => entry.id === mealId)
      expect(meal?.meal_items[0]).toMatchObject({
        foodName: `Beta soup ${tag}`,
        snapshot_calories: 400,
      })

      const inactive = await row(admin, `Beta soup ${tag}`)
      expect(inactive).toMatchObject({ status: 'INACTIVE', notes: 'Duplicate' })
      // The version seen before deactivating is stale now.
      expect(
        await codeOf(
          setFoodActive(admin, {
            id: food.id,
            version: food.updatedAt,
            active: true,
            reason: null,
          }),
        ),
      ).toBe('PT409')
      await setFoodActive(admin, {
        id: food.id,
        version: inactive.updatedAt,
        active: true,
        reason: null,
      })
      expect((await searchFoods(user, `Beta soup ${tag}`)).map((entry) => entry.id)).toContain(
        food.id,
      )
    })
  })

  describe('historical integrity', () => {
    it('an edit never changes logged meals; new logs use the new values', async () => {
      const food = await row(admin, `Alpha soup ${tag}`)
      const [option] = await searchFoods(user, `Alpha soup ${tag}`)
      const before = await logMeal(user, {
        date: TODAY,
        category: 'LUNCH',
        items: [draft(option, 150)],
      })

      await updateFood(admin, {
        id: food.id,
        version: food.updatedAt,
        values: values(`Alpha soup ${tag}`, { calories: 120, proteinG: 4 }),
        isApproximate: true,
        reason: 'Recipe corrected',
      })
      // A second admin still holding the old version is refused.
      expect(
        await codeOf(
          updateFood(admin, {
            id: food.id,
            version: food.updatedAt,
            values: values(`Alpha soup ${tag}`, { calories: 999 }),
            isApproximate: true,
            reason: null,
          }),
        ),
      ).toBe('PT409')

      const [updated] = await searchFoods(user, `Alpha soup ${tag}`)
      expect(updated).toMatchObject({ calories: 120, proteinG: 4 })
      const after = await logMeal(user, {
        date: TODAY,
        category: 'DINNER',
        items: [draft(updated, 150)],
      })

      const meals = await fetchDayMeals(user, userId, TODAY)
      const old = meals.find((meal) => meal.id === before)?.meal_items[0]
      const fresh = meals.find((meal) => meal.id === after)?.meal_items[0]
      expect(old).toMatchObject({ snapshot_calories: 300, snapshot_protein_g: 15 })
      expect(fresh).toMatchObject({ snapshot_calories: 180, snapshot_protein_g: 6 })
    })
  })

  describe('review of user-created foods', () => {
    let pending: FoodOption

    it('a food a user creates waits for review and is only theirs meanwhile', async () => {
      pending = await submitFood(
        user,
        userId,
        values(`Chicken biryani ${tag}`, {
          servingQuantity: 1,
          servingUnit: 'plate',
          calories: 600,
          proteinG: 25,
          carbsG: 80,
          fatG: 18,
        }),
      )
      await logMeal(user, { date: TODAY, category: null, items: [draft(pending, 1)] })
      expect((await searchFoods(user, `Chicken biryani ${tag}`))[0]).toMatchObject({
        source: 'SUBMISSION',
        reviewStatus: 'PENDING_REVIEW',
      })
      expect(
        (await searchFoods(other, `Chicken biryani ${tag}`)).map((entry) => entry.id),
      ).not.toContain(pending.id)

      const queued = await row(admin, `Chicken biryani ${tag}`, 'SUBMISSION')
      expect(queued).toMatchObject({
        status: 'PENDING_REVIEW',
        source: 'USER_SUBMISSION',
        submittedByName: 'Home Test',
      })
      const queue = await listFoods(admin, filters({ status: 'PENDING_REVIEW' }), 0)
      expect(queue.rows.some((entry) => entry.id === pending.id)).toBe(true)
    })

    it('a user cannot review their own food, even by calling the function', async () => {
      const queued = await row(admin, `Chicken biryani ${tag}`, 'SUBMISSION')
      expect(
        await codeOf(
          approveFoodSubmission(user, {
            id: queued.id,
            version: queued.updatedAt,
            values: values(queued.name),
            isApproximate: false,
            notes: null,
          }),
        ),
      ).toBe('42501')
      const direct = await user
        .from('food_submissions')
        .update({ status: 'APPROVED' })
        .eq('id', queued.id)
      expect(direct.error?.code).toBe('42501')
    })

    it('shows likely duplicates of the food under review', async () => {
      await createFood(admin, {
        values: values(`Chicken biryani restaurant ${tag}`),
        isApproximate: true,
        active: true,
      })
      const duplicates = await fetchFoodDuplicates(admin, `Chicken biryani ${tag}`, null)
      expect(duplicates.map((food) => food.name)).toContain(`Chicken biryani restaurant ${tag}`)
    })

    it('approval makes it a shared food for every user, with its history intact', async () => {
      const queued = await row(admin, `Chicken biryani ${tag}`, 'SUBMISSION')
      const foodId = await approveFoodSubmission(admin, {
        id: queued.id,
        version: queued.updatedAt,
        values: values(`Chicken biryani home ${tag}`, {
          servingQuantity: 1,
          servingUnit: 'plate',
          calories: 600,
          proteinG: 25,
          carbsG: 80,
          fatG: 18,
        }),
        isApproximate: true,
        notes: 'Checked',
      })
      // Twice is refused: the version has moved on.
      expect(
        await codeOf(
          approveFoodSubmission(admin, {
            id: queued.id,
            version: queued.updatedAt,
            values: values(`X ${tag}`),
            isApproximate: true,
            notes: null,
          }),
        ),
      ).toBe('PT409')

      const [forOther] = await searchFoods(other, `Chicken biryani home ${tag}`)
      expect(forOther).toMatchObject({ id: foodId, source: 'FOOD', calories: 600 })
      const logged = await logMeal(other, {
        date: TODAY,
        category: null,
        items: [draft(forOther, 2)],
      })
      expect(logged).toBeTruthy()

      // The creator does not have to create it again: it is in their recent foods.
      const recent = await fetchFoodUsage(user, 'recent')
      expect(recent.find((food) => food.id === foodId)).toMatchObject({ source: 'FOOD' })
      expect(
        (await fetchMySubmissions(user, userId)).find((food) => food.id === pending.id)?.status,
      ).toBe('APPROVED')

      const approved = await row(admin, `Chicken biryani home ${tag}`)
      expect(approved).toMatchObject({ source: 'USER_SUBMISSION', status: 'ACTIVE' })
    })

    it('a copied meal logs the shared food', async () => {
      const meals = await fetchDayMeals(user, userId, TODAY)
      const original = meals.find((meal) =>
        meal.meal_items.some((item) => item.foodName === `Chicken biryani ${tag}`),
      )
      expect(original).toBeDefined()
      const copyId = await copyMeal(user, { mealId: original?.id ?? '', date: TODAY })
      const copy = (await fetchDayMeals(user, userId, TODAY)).find((meal) => meal.id === copyId)
      expect(copy?.meal_items[0]).toMatchObject({
        foodName: `Chicken biryani home ${tag}`,
        isUserFood: false,
      })
      // The original still shows what was logged.
      expect(original?.meal_items[0]).toMatchObject({
        foodName: `Chicken biryani ${tag}`,
        snapshot_calories: 600,
      })
    })

    it('rejection keeps the record but the food is never shared', async () => {
      const submission = await submitFood(other, otherId, values(`Mystery curry ${tag}`))
      const queued = await row(admin, `Mystery curry ${tag}`, 'SUBMISSION')
      await rejectFoodSubmission(admin, {
        id: queued.id,
        version: queued.updatedAt,
        notes: 'Values not plausible',
      })

      expect(
        (await searchFoods(other, `Mystery curry ${tag}`)).map((entry) => entry.id),
      ).not.toContain(submission.id)
      expect(
        (await searchFoods(user, `Mystery curry ${tag}`)).map((entry) => entry.id),
      ).not.toContain(submission.id)
      expect(
        await codeOf(
          logMeal(other, { date: TODAY, category: null, items: [draft(submission, 1)] }),
        ),
      ).toBe('23503')
      const rejected = await row(admin, `Mystery curry ${tag}`, 'SUBMISSION')
      expect(rejected).toMatchObject({ status: 'REJECTED', notes: 'Values not plausible' })
      expect(
        (await fetchMySubmissions(other, otherId)).find((food) => food.id === submission.id)
          ?.status,
      ).toBe('REJECTED')
    })
  })
})
