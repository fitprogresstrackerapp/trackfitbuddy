import { formatNumber } from '@/lib/format'

import type {
  FoodAdminRow,
  FoodAdminStatus,
  FoodSort,
  FoodSource,
  FoodValues,
} from '../api/food-admin-data'

/* Pure display rules for the admin Food Database. Nothing is decided here. */

export const FOOD_STATUS_LABELS: Record<FoodAdminStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PENDING_REVIEW: 'Pending review',
  REJECTED: 'Rejected',
}

/** Where a food came from. A user's food is never called verified. */
export const FOOD_SOURCE_LABELS: Record<FoodSource, string> = {
  CATALOGUE: 'Starter catalogue',
  ADMIN: 'Added by admin',
  USER_SUBMISSION: 'User-created',
}

export const FOOD_SORT_LABELS: Record<FoodSort, string> = {
  NAME: 'Name',
  NEWEST: 'Newest',
  UPDATED: 'Recently updated',
  STATUS: 'Review status',
}

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** A timestamp as a calendar day in the viewer's timezone: "12 Oct 2026". */
export const formatDay = (timestamp: string) => day.format(new Date(timestamp))

/** "per 100 g", "per 1 bowl": the basis of every nutrition value shown. */
export function servingBasis(food: Pick<FoodValues, 'servingQuantity' | 'servingUnit'>): string {
  return `per ${formatNumber(food.servingQuantity, 2)} ${food.servingUnit}`
}

/** A user-created food approved into the catalogue keeps saying where it came from. */
export function sourceLabel(row: Pick<FoodAdminRow, 'source' | 'kind'>): string {
  return row.source === 'USER_SUBMISSION' && row.kind === 'FOOD'
    ? 'User-created, approved'
    : FOOD_SOURCE_LABELS[row.source]
}

export const isFoodStatus = (value: string | null): value is FoodAdminStatus =>
  value !== null && value in FOOD_STATUS_LABELS

/** The form's text values for an existing food. */
export function toFormValues(food: FoodValues) {
  return {
    name: food.name,
    servingQuantity: String(food.servingQuantity),
    servingUnit: food.servingUnit,
    calories: String(food.calories),
    proteinG: String(food.proteinG),
    carbsG: String(food.carbsG),
    fatG: String(food.fatG),
    fiberG: String(food.fiberG),
  }
}

export const EMPTY_FOOD_FORM = {
  name: '',
  servingQuantity: '100',
  servingUnit: 'g',
  calories: '',
  proteinG: '',
  carbsG: '',
  fatG: '',
  fiberG: '',
}
