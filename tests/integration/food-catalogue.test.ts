/**
 * The starter-catalogue loader (scripts/seed-foods.ts) against the real local
 * database, with a small uniquely named catalogue so no other suite is affected.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { searchFoods } from '@/features/food/api/food-data'

import { seedFoodCatalogue, type CatalogueFood } from '../../scripts/lib/food-catalogue.ts'
import { uniqueTag } from './food-fixtures.ts'
import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must } from './home-fixtures.ts'

describe('Starter food catalogue loader', () => {
  const service = adminClient()
  const tag = uniqueTag()
  const catalogue: CatalogueFood[] = [
    {
      name: `Catalogue idli ${tag}`,
      serving_quantity: 1,
      serving_unit: 'piece',
      calories: 45,
      protein_g: 1.6,
      carbs_g: 8.9,
      fat_g: 0.2,
      fiber_g: 0.6,
    },
    {
      name: `Catalogue dal ${tag}`,
      serving_quantity: 1,
      serving_unit: 'bowl',
      calories: 210,
      protein_g: 11,
      carbs_g: 28,
      fat_g: 6,
      fiber_g: 7,
    },
  ]
  let user: BrowserClient

  beforeAll(async () => {
    const account = await createUser('1111')
    await completeProfile(service, account.userId)
    user = await signedInClient(account.phone, account.pin)
  })

  it('a dry run reports the foods and writes nothing', async () => {
    const result = await seedFoodCatalogue(service, catalogue, { dryRun: true })
    expect(result).toEqual({ added: catalogue.map((food) => food.name), skipped: 0 })
    // Search is fuzzy, so look for this run's exact names.
    const found = await searchFoods(user, `Catalogue idli ${tag}`)
    expect(found.filter((food) => food.name.endsWith(tag))).toEqual([])
  })

  it('adds the foods as shared, approximate foods with a version record', async () => {
    const result = await seedFoodCatalogue(service, catalogue)
    expect(result.added).toHaveLength(2)
    const rows = await must(
      service
        .from('food_items')
        .select('id, name, is_approximate, version, calories')
        .like('name', `Catalogue % ${tag}`)
        .order('name'),
    )
    expect(rows).toMatchObject([
      { name: `Catalogue dal ${tag}`, is_approximate: true, version: 1, calories: 210 },
      { name: `Catalogue idli ${tag}`, is_approximate: true, version: 1, calories: 45 },
    ])
    const versions = await must(
      service
        .from('food_item_versions')
        .select('food_item_id')
        .in(
          'food_item_id',
          rows.map((row) => row.id),
        ),
    )
    expect(versions).toHaveLength(2)
  })

  it('any signed-in user can then find and use them', async () => {
    const found = await searchFoods(user, `catalogue idli ${tag}`)
    // Search is fuzzy; the exact food ranks first.
    expect(found[0]).toMatchObject({ name: `Catalogue idli ${tag}`, calories: 45 })
  })

  it('running it again adds nothing and changes nothing', async () => {
    await must(
      service
        .from('food_items')
        .update({ calories: 50 })
        .eq('name', `Catalogue idli ${tag}`)
        .select('id'),
    )
    const result = await seedFoodCatalogue(service, catalogue)
    expect(result).toEqual({ added: [], skipped: 2 })
    // An admin's later correction is not overwritten by a re-run.
    const row = await must(
      service.from('food_items').select('calories').eq('name', `Catalogue idli ${tag}`).single(),
    )
    expect(row.calories).toBe(50)
  })

  it('a normal user still cannot add shared foods directly', async () => {
    const attempt = await user.from('food_items').insert({
      name: `Sneaky ${tag}`,
      serving_quantity: 1,
      serving_unit: 'piece',
      calories: 1,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    })
    expect(attempt.error).not.toBeNull()
  })
})
