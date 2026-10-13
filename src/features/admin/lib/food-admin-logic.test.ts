import { describe, expect, it } from 'vitest'

import { hasEnergyMismatch, macroEnergy } from '@/features/food/lib/food-quality'

import { isFoodStatus, servingBasis, sourceLabel, toFormValues } from './food-admin-logic'

describe('food plausibility (shared with the starter catalogue)', () => {
  it('derives energy from the macros at 4 / 4 / 9 kcal per gram', () => {
    expect(macroEnergy({ protein_g: 10, carbs_g: 20, fat_g: 2 })).toBe(138)
  })

  it('flags calories far from the macros, never small differences', () => {
    expect(hasEnergyMismatch({ calories: 150, protein_g: 10, carbs_g: 20, fat_g: 2 })).toBe(false)
    expect(hasEnergyMismatch({ calories: 900, protein_g: 10, carbs_g: 20, fat_g: 2 })).toBe(true)
    // Within 25 kcal is always accepted, even when that is more than 20%.
    expect(hasEnergyMismatch({ calories: 20, protein_g: 0, carbs_g: 0, fat_g: 0 })).toBe(false)
  })
})

describe('admin food labels', () => {
  it('states the serving every value is for', () => {
    expect(servingBasis({ servingQuantity: 100, servingUnit: 'g' })).toBe('per 100 g')
    expect(servingBasis({ servingQuantity: 1.5, servingUnit: 'bowl' })).toBe('per 1.5 bowl')
  })

  it('keeps the provenance of an approved user food', () => {
    expect(sourceLabel({ source: 'USER_SUBMISSION', kind: 'SUBMISSION' })).toBe('User-created')
    expect(sourceLabel({ source: 'USER_SUBMISSION', kind: 'FOOD' })).toBe('User-created, approved')
    expect(sourceLabel({ source: 'CATALOGUE', kind: 'FOOD' })).toBe('Starter catalogue')
  })

  it('accepts only known statuses from the address', () => {
    expect(isFoodStatus('PENDING_REVIEW')).toBe(true)
    expect(isFoodStatus('MERGED')).toBe(false)
    expect(isFoodStatus(null)).toBe(false)
  })

  it('fills the form with the stored values, unchanged', () => {
    expect(
      toFormValues({
        name: 'Dal',
        servingQuantity: 1,
        servingUnit: 'bowl',
        calories: 180.5,
        proteinG: 9,
        carbsG: 24,
        fatG: 5,
        fiberG: 6,
      }),
    ).toEqual({
      name: 'Dal',
      servingQuantity: '1',
      servingUnit: 'bowl',
      calories: '180.5',
      proteinG: '9',
      carbsG: '24',
      fatG: '5',
      fiberG: '6',
    })
  })
})
