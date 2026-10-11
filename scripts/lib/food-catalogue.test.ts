// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  catalogueFoodSchema,
  catalogueSchema,
  foodsToAdd,
  inconsistentFoods,
  normalizeFoodName,
  type CatalogueFood,
} from './food-catalogue.ts'

const file = resolve(import.meta.dirname, '../../supabase/seeds/starter-foods.json')
const catalogue = catalogueSchema.parse(JSON.parse(readFileSync(file, 'utf8')))

const food = (overrides: Partial<CatalogueFood> = {}): CatalogueFood => ({
  name: 'Test food',
  serving_quantity: 100,
  serving_unit: 'g',
  calories: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
  fiber_g: 0,
  ...overrides,
})

describe('starter food catalogue (the real file)', () => {
  it('every entry satisfies the database rules', () => {
    expect(catalogue.foods.length).toBeGreaterThanOrEqual(60)
    for (const entry of catalogue.foods) {
      expect(entry.serving_unit, entry.name).toMatch(/^[a-z][a-z ]{0,19}$/)
      expect(entry.serving_quantity, entry.name).toBeGreaterThan(0)
    }
  })

  it('has no duplicate names', () => {
    const names = catalogue.foods.map((entry) => normalizeFoodName(entry.name))
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })

  it('calories agree with the macros (catches typing errors)', () => {
    expect(inconsistentFoods(catalogue.foods)).toEqual([])
  })

  it('covers the spec §11 focus: Indian staples, local foods and protein sources', () => {
    const names = catalogue.foods.map((entry) => entry.name.toLowerCase()).join(' | ')
    for (const expected of [
      'idli',
      'dosa',
      'chapati',
      'rice',
      'dal',
      'biryani',
      'paneer',
      'egg',
      'chicken breast',
      'curd',
    ]) {
      expect(names, expected).toContain(expected)
    }
  })

  it('says its values are approximate', () => {
    expect(catalogue._about).toMatch(/approximate/i)
  })
})

describe('catalogue validation', () => {
  it('rejects values the database would refuse', () => {
    expect(catalogueFoodSchema.safeParse(food({ serving_unit: 'Bowl' })).success).toBe(false)
    expect(catalogueFoodSchema.safeParse(food({ serving_quantity: 0 })).success).toBe(false)
    expect(catalogueFoodSchema.safeParse(food({ calories: -1 })).success).toBe(false)
    expect(catalogueFoodSchema.safeParse(food({ name: '   ' })).success).toBe(false)
    expect(catalogueFoodSchema.safeParse({ ...food(), is_approximate: false }).success).toBe(false)
    expect(catalogueFoodSchema.safeParse(food({ carbs_g: 5, fiber_g: 9 })).success).toBe(false)
  })

  it('flags calories that do not match the macros', () => {
    expect(inconsistentFoods([food(), food({ name: 'Typo', calories: 1650 })])).toEqual(['Typo'])
  })
})

describe('foodsToAdd', () => {
  it('skips foods already present, comparing names loosely', () => {
    const list = [food({ name: 'Idli' }), food({ name: 'Dosa, plain' }), food({ name: 'Banana' })]
    expect(foodsToAdd(list, ['  idli ', 'DOSA,  PLAIN']).map((entry) => entry.name)).toEqual([
      'Banana',
    ])
  })

  it('adds nothing on a second run', () => {
    const list = [food({ name: 'Idli' }), food({ name: 'Banana' })]
    expect(foodsToAdd(list, ['Idli', 'Banana'])).toEqual([])
  })

  it('never adds the same name twice from one file', () => {
    expect(foodsToAdd([food({ name: 'Idli' }), food({ name: 'idli' })], [])).toHaveLength(1)
  })
})
