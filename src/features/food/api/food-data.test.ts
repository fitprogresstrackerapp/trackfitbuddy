import { describe, expect, it, vi } from 'vitest'

import type { AppSupabaseClient } from '@/lib/supabase/client'

import type { DraftItem, FoodOption } from '../types'
import { addItemsToMeal, logMeal } from './food-data'

function food(source: FoodOption['source'], id: string): FoodOption {
  return {
    source,
    id,
    name: 'Chicken breast',
    servingQuantity: 100,
    servingUnit: 'g',
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatG: 3.6,
    fiberG: 0,
    isApproximate: false,
    reviewStatus: null,
    useCount: 0,
    lastUsed: null,
  }
}

const ITEMS: DraftItem[] = [
  { key: 'a', food: food('FOOD', 'food-1'), quantity: 200 },
  { key: 'b', food: food('SUBMISSION', 'sub-1'), quantity: 1.5 },
]

function fakeClient() {
  const rpc = vi.fn().mockResolvedValue({ data: 'meal-1', error: null })
  return { client: { rpc } as unknown as AppSupabaseClient, rpc }
}

describe('food writes send only foods and quantities', () => {
  it('logMeal passes food ids + quantities; never nutrition, names or units', async () => {
    const { client, rpc } = fakeClient()
    await logMeal(client, { date: '2026-09-27', category: 'LUNCH', items: ITEMS })
    expect(rpc).toHaveBeenCalledWith('log_meal', {
      p_meal_date: '2026-09-27',
      p_meal_category: 'LUNCH',
      p_items: [
        { food_item_id: 'food-1', quantity: 200 },
        { food_submission_id: 'sub-1', quantity: 1.5 },
      ],
    })
  })

  it('logMeal omits the category when none is chosen', async () => {
    const { client, rpc } = fakeClient()
    await logMeal(client, { date: '2026-09-27', category: null, items: ITEMS.slice(0, 1) })
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_meal_category')
  })

  it('addItemsToMeal targets the existing meal', async () => {
    const { client, rpc } = fakeClient()
    await addItemsToMeal(client, { mealId: 'meal-9', items: ITEMS.slice(0, 1) })
    expect(rpc).toHaveBeenCalledWith('add_meal_items', {
      p_meal_id: 'meal-9',
      p_items: [{ food_item_id: 'food-1', quantity: 200 }],
    })
  })

  it('surfaces database errors to the caller', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } })
    await expect(
      logMeal({ rpc } as unknown as AppSupabaseClient, {
        date: '2026-09-27',
        category: null,
        items: ITEMS,
      }),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
