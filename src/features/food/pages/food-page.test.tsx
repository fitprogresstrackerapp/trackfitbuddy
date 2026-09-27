import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchTargetsForDate } from '@/features/nutrition/api/targets'
import type { DailyTargets } from '@/features/nutrition/types'
import { renderApp, signedIn } from '@/test/auth-harness'

import {
  addItemsToMeal,
  deleteMeal,
  fetchCopyCandidates,
  fetchDayMeals,
  fetchFoodUsage,
  fetchMySubmissions,
  logMeal,
  searchFoods,
  submitFood,
} from '../api/food-data'
import type { FoodOption, LoggedItem, LoggedMeal } from '../types'

vi.mock('../api/food-data', () => ({
  fetchDayMeals: vi.fn(),
  fetchCopyCandidates: vi.fn(),
  fetchFoodUsage: vi.fn(),
  fetchMySubmissions: vi.fn(),
  searchFoods: vi.fn(),
  logMeal: vi.fn(),
  addItemsToMeal: vi.fn(),
  updateItemQuantity: vi.fn(),
  deleteItem: vi.fn(),
  deleteMeal: vi.fn(),
  updateMealCategory: vi.fn(),
  copyMeal: vi.fn(),
  submitFood: vi.fn(),
}))
vi.mock('@/features/nutrition/api/targets', () => ({ fetchTargetsForDate: vi.fn() }))
vi.mock('@/features/home/api/home-data', () => ({
  fetchHomePlan: vi.fn(),
  fetchHomeNutrition: vi.fn(),
  fetchHomeTraining: vi.fn(),
}))

const TODAY = '2026-09-24' // in Asia/Kolkata at NOW
const NOW = new Date('2026-09-24T04:30:00Z')

const TARGETS: DailyTargets = {
  calories: 2000,
  proteinG: 140,
  carbsG: 230,
  fatG: 65,
  fiberG: 30,
  workoutsPerWeek: 4,
  tolerance: { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 },
  source: 'snapshot',
}

function food(overrides: Partial<FoodOption> = {}): FoodOption {
  return {
    source: 'FOOD',
    id: 'banana',
    name: 'Banana',
    servingQuantity: 1,
    servingUnit: 'piece',
    calories: 105,
    proteinG: 1.3,
    carbsG: 27,
    fatG: 0.4,
    fiberG: 3.1,
    isApproximate: false,
    reviewStatus: null,
    useCount: 3,
    lastUsed: '2026-09-23T10:00:00Z',
    ...overrides,
  }
}

function item(overrides: Partial<LoggedItem> = {}): LoggedItem {
  return {
    id: 'item-1',
    foodName: 'Chicken breast',
    quantity: 200,
    unit: 'g',
    isUserFood: false,
    isApproximate: false,
    snapshot_calories: 330,
    snapshot_protein_g: 62,
    snapshot_carbs_g: 0,
    snapshot_fat_g: 7.2,
    snapshot_fiber_g: 0,
    ...overrides,
  }
}

function meal(overrides: Partial<LoggedMeal> = {}): LoggedMeal {
  return {
    id: 'meal-1',
    date: TODAY,
    category: 'LUNCH',
    name: null,
    isLocked: false,
    copiedFromMealId: null,
    createdAt: '2026-09-24T07:00:00Z',
    meal_items: [item()],
    ...overrides,
  }
}

function closest(element: HTMLElement, selector: string): HTMLElement {
  const found = element.closest<HTMLElement>(selector)
  if (!found) throw new Error(`No ${selector} around element`)
  return found
}

const main = () => document.querySelector('main')?.textContent ?? ''

async function openFood(path = '/food') {
  renderApp({ path, state: signedIn() })
  await screen.findByRole('heading', { level: 1, name: 'Food' })
  await waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
}

async function openAddSheet() {
  const [button] = screen.getAllByRole('button', { name: /^add food$/i })
  if (!button) throw new Error('Add food button missing')
  fireEvent.click(button)
  return screen.findByRole('dialog')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTargetsForDate).mockResolvedValue({ targets: TARGETS, cycle: null })
  vi.mocked(fetchDayMeals).mockResolvedValue([])
  vi.mocked(fetchCopyCandidates).mockResolvedValue([])
  vi.mocked(fetchFoodUsage).mockResolvedValue([food()])
  vi.mocked(fetchMySubmissions).mockResolvedValue([])
  vi.mocked(searchFoods).mockResolvedValue([])
  vi.mocked(logMeal).mockResolvedValue('new-meal')
  vi.mocked(addItemsToMeal).mockResolvedValue()
  vi.mocked(deleteMeal).mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Food summary', () => {
  it('shows — (not 0) when nothing is logged, with the day’s targets', async () => {
    await openFood()
    expect(main()).toMatch(/Calories(Food target)?—/)
    expect(main()).not.toMatch(/Calories(Food target)?0/)
    expect(main()).toContain('/ 2,000')
    expect(main()).toContain('/ 140')
    expect(main()).toContain('No meals logged today')
    expect(fetchDayMeals).toHaveBeenCalledWith(expect.anything(), expect.any(String), TODAY)
  })

  it('a failed meals query shows an error, never zero intake', async () => {
    vi.mocked(fetchDayMeals).mockRejectedValue(new Error('network'))
    await openFood()
    expect(await screen.findByText('Nutrition couldn’t be loaded')).toBeTruthy()
    expect(screen.getByText('Meals couldn’t be loaded')).toBeTruthy()
    expect(main()).not.toMatch(/Calories/)
    expect(main()).not.toMatch(/\b0 KCAL/i)
  })

  it('daily totals are the sum of meal-item snapshots', async () => {
    vi.mocked(fetchDayMeals).mockResolvedValue([
      meal({
        meal_items: [
          item(),
          item({
            id: 'b',
            foodName: 'Banana',
            quantity: 2,
            unit: 'piece',
            snapshot_calories: 210,
            snapshot_protein_g: 2.6,
          }),
        ],
      }),
    ])
    await openFood()
    expect(main()).toMatch(/Calories(Food target)?540/)
    expect(main()).toContain('1,460 kcal remaining')
    expect(main()).toContain('64.6')
  })

  it('without an active target shows intake only and fabricates nothing', async () => {
    vi.mocked(fetchTargetsForDate).mockResolvedValue({ targets: null, cycle: null })
    vi.mocked(fetchDayMeals).mockResolvedValue([meal()])
    await openFood()
    expect(main()).toContain('No active recommendation')
    expect(main()).toMatch(/Calories330/)
    expect(main()).not.toMatch(/\/ \d/)
    expect(main()).not.toMatch(/range/i)
  })

  it('a failed targets query keeps intake visible and offers a retry', async () => {
    vi.mocked(fetchTargetsForDate).mockRejectedValue(new Error('network'))
    vi.mocked(fetchDayMeals).mockResolvedValue([meal()])
    await openFood()
    expect(main()).toContain('Targets couldn’t be loaded')
    expect(main()).toMatch(/Calories330/)
  })

  it('judges calories as a range, separately from higher-is-better macros', async () => {
    vi.mocked(fetchDayMeals).mockResolvedValue([
      meal({ meal_items: [item({ snapshot_calories: 2150, snapshot_protein_g: 120 })] }),
    ])
    await openFood()
    // 2,150 kcal is above target but within 2,000 × 1.10 → "Within range".
    expect(main()).toContain('Within range')
    expect(main()).toContain('150 kcal over target')
    // 120 g ≥ 140 × 0.85 (snapshot tolerance) → protein met.
    const protein = closest(screen.getByText('Protein'), 'div.flex.flex-col')
    expect(within(protein).getByText('Met')).toBeTruthy()
  })

  it('macro tolerance comes from the target snapshot, not a hard-coded 85%', async () => {
    vi.mocked(fetchTargetsForDate).mockResolvedValue({
      targets: { ...TARGETS, tolerance: { nutrient: 0.9, calorieLower: 0.8, calorieUpper: 1.05 } },
      cycle: null,
    })
    vi.mocked(fetchDayMeals).mockResolvedValue([
      meal({ meal_items: [item({ snapshot_calories: 2150, snapshot_protein_g: 120 })] }),
    ])
    await openFood()
    const protein = closest(screen.getByText('Protein'), 'div.flex.flex-col')
    expect(within(protein).queryByText('Met')).toBeNull() // 120 < 140 × 0.90
    expect(main()).toContain('Above range') // 2,150 > 2,000 × 1.05
  })
})

describe('Meals', () => {
  it('today’s meal is editable; the category or a neutral label names it', async () => {
    vi.mocked(fetchDayMeals).mockResolvedValue([
      meal(),
      meal({
        id: 'plain',
        category: null,
        meal_items: [item({ id: 'x', foodName: 'Idli', isApproximate: true })],
      }),
    ])
    await openFood()
    expect(screen.getByRole('article', { name: 'Lunch' })).toBeTruthy()
    const plain = screen.getByRole('article', { name: 'Meal' })
    expect(within(plain).getByLabelText('Estimated values')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit quantity of Chicken breast' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Chicken breast' })).toBeTruthy()
    expect(main()).not.toContain('Locked')
  })

  it('a locked meal is shown as LOCKED with no edit or delete controls', async () => {
    const past = '2026-09-21'
    vi.mocked(fetchDayMeals).mockResolvedValue([
      meal({ date: past, isLocked: true, category: 'DINNER' }),
    ])
    await openFood(`/food?date=${past}`)
    const dinner = screen.getByRole('article', { name: 'Dinner' })
    expect(within(dinner).getByText('Locked')).toBeTruthy()
    expect(within(dinner).queryByRole('button', { name: /edit quantity/i })).toBeNull()
    expect(within(dinner).queryByRole('button', { name: /^remove/i })).toBeNull()
    expect(main()).toContain('Food history is locked')
    expect(main()).toContain('You can view existing entries.')

    fireEvent.keyDown(within(dinner).getByRole('button', { name: 'Dinner actions' }), {
      key: 'Enter',
    })
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText('Delete meal')).toBeNull()
    expect(within(menu).queryByText('Add food')).toBeNull()
    expect(within(menu).getByText('Copy to today')).toBeTruthy()
  })

  it('an empty past day invites a late entry; past 90 days it is read-only', async () => {
    await openFood('/food?date=2026-09-20')
    expect(main()).toContain(
      'You can add missing food for this day. Once added, historical entries are locked.',
    )
    expect(screen.getAllByRole('button', { name: /add missing meal/i }).length).toBeGreaterThan(0)
    cleanup()

    await openFood('/food?date=2026-06-01')
    expect(main()).toContain('This day is read-only')
    expect(screen.queryByRole('button', { name: /add missing meal/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy meal/i })).toBeNull()
  })

  it('a future date is never offered: it falls back to today with a notice', async () => {
    await openFood('/food?date=2026-09-25')
    expect(main()).toContain('Showing today')
    expect(fetchDayMeals).toHaveBeenCalledWith(expect.anything(), expect.any(String), TODAY)
    expect(fetchDayMeals).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      '2026-09-25',
    )
    expect(screen.getByLabelText('Date').getAttribute('max')).toBe(TODAY)
    expect(screen.getByRole('button', { name: 'Next day' }).hasAttribute('disabled')).toBe(true)
  })

  it('deleting a meal asks for confirmation first', async () => {
    vi.mocked(fetchDayMeals).mockResolvedValue([meal()])
    await openFood()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lunch actions' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete meal/i }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Delete Lunch?')).toBeTruthy()
    expect(deleteMeal).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete meal' }))
    await waitFor(() => {
      expect(deleteMeal).toHaveBeenCalledWith(expect.anything(), 'meal-1')
    })
  })
})

describe('Adding food', () => {
  it('select → quantity → review → save creates a new meal with food + quantity only', async () => {
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.click(await within(sheet).findByRole('button', { name: /banana/i }))
    const quantity = await within(sheet).findByLabelText('Quantity')
    expect(within(sheet).getByText('Unit: piece (this food’s serving unit)')).toBeTruthy()
    fireEvent.change(quantity, { target: { value: '2' } })
    expect(within(sheet).getByText(/≈ 210 kcal/)).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to meal' }))
    expect(await within(sheet).findByText('1 food')).toBeTruthy()

    const fetchesBefore = vi.mocked(fetchDayMeals).mock.calls.length
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save meal' }))
    await waitFor(() => {
      expect(logMeal).toHaveBeenCalledTimes(1)
    })
    const [, input] = vi.mocked(logMeal).mock.calls[0] ?? []
    expect(input).toMatchObject({ date: TODAY, category: null })
    expect(input?.items.map((entry) => [entry.food.id, entry.quantity])).toEqual([['banana', 2]])
    // Authoritative values are re-read from the database (no optimistic totals).
    await waitFor(() => {
      expect(vi.mocked(fetchDayMeals).mock.calls.length).toBeGreaterThan(fetchesBefore)
    })
  })

  it('adds to today’s existing meal of the chosen category instead of duplicating it', async () => {
    vi.mocked(fetchDayMeals).mockResolvedValue([meal()])
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.click(await within(sheet).findByRole('button', { name: /banana/i }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add to meal' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Lunch' }))
    expect(
      within(sheet).getByText('Adds to today’s Lunch instead of creating another one.'),
    ).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to Lunch' }))
    await waitFor(() => {
      expect(addItemsToMeal).toHaveBeenCalledWith(expect.anything(), {
        mealId: 'meal-1',
        items: [expect.objectContaining({ quantity: 1 })],
      })
    })
    expect(logMeal).not.toHaveBeenCalled()
  })

  it('validates the quantity before adding', async () => {
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.click(await within(sheet).findByRole('button', { name: /banana/i }))
    fireEvent.change(await within(sheet).findByLabelText('Quantity'), { target: { value: '0' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to meal' }))
    expect(await within(sheet).findByText('Quantity must be more than 0')).toBeTruthy()
    fireEvent.change(within(sheet).getByLabelText('Quantity'), { target: { value: '1.555' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to meal' }))
    expect(await within(sheet).findByText('Use a number with up to 2 decimals')).toBeTruthy()
  })

  it('a past-day entry warns that it locks once saved', async () => {
    await openFood('/food?date=2026-09-22')
    const [button] = screen.getAllByRole('button', { name: /add missing meal/i })
    if (!button) throw new Error('missing button')
    fireEvent.click(button)
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Locked once saved')).toBeTruthy()
    fireEvent.click(await within(sheet).findByRole('button', { name: /banana/i }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add to meal' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save missing meal' }))
    await waitFor(() => {
      expect(logMeal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ date: '2026-09-22' }),
      )
    })
  })

  it('shows a friendly message when saving fails, without database details', async () => {
    vi.mocked(logMeal).mockRejectedValue({
      code: 'XX000',
      message: 'insert or update on table "meal_items" violates foreign key constraint',
    })
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.click(await within(sheet).findByRole('button', { name: /banana/i }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add to meal' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save meal' }))
    expect(
      await within(sheet).findByText('Couldn’t save this food. Please try again.'),
    ).toBeTruthy()
    expect(sheet.textContent).not.toMatch(/constraint|meal_items/)
  })
})

describe('Search', () => {
  it('is debounced: one request for fast typing', async () => {
    await openFood()
    const sheet = await openAddSheet()
    const input = within(sheet).getByLabelText('Search foods')
    for (const value of ['b', 'ba', 'ban', 'bana']) fireEvent.change(input, { target: { value } })
    await waitFor(() => {
      expect(searchFoods).toHaveBeenCalled()
    })
    expect(searchFoods).toHaveBeenCalledTimes(1)
    expect(searchFoods).toHaveBeenCalledWith(expect.anything(), 'bana')
  })

  it('keeps the server ranking and marks each food’s source', async () => {
    vi.mocked(searchFoods).mockResolvedValue([
      food({
        id: 'mine',
        name: 'Chicken biryani home',
        source: 'SUBMISSION',
        reviewStatus: 'PENDING_REVIEW',
      }),
      food({ id: 'shared', name: 'Chicken biryani (restaurant)', isApproximate: true }),
    ])
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.change(within(sheet).getByLabelText('Search foods'), { target: { value: 'biryani' } })
    const list = await within(sheet).findByRole('list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('Chicken biryani home')
    expect(rows[0]?.textContent).toContain('Pending review')
    expect(rows[1]?.textContent).toContain('Verified')
    expect(rows[1]?.textContent).toContain('≈ Est.')
  })

  it('shows recent and frequent foods before any search', async () => {
    vi.mocked(fetchFoodUsage).mockImplementation((_client, order) =>
      Promise.resolve(order === 'recent' ? [food()] : [food({ id: 'rice', name: 'Rice' })]),
    )
    await openFood()
    const sheet = await openAddSheet()
    expect(await within(sheet).findByRole('button', { name: /banana/i })).toBeTruthy()
    fireEvent.mouseDown(within(sheet).getByRole('radio', { name: 'Frequent' }))
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Frequent' }))
    expect(await within(sheet).findByRole('button', { name: /rice/i })).toBeTruthy()
    expect(fetchFoodUsage).toHaveBeenCalledWith(expect.anything(), 'frequent')
  })
})

describe('User foods', () => {
  async function openCreate() {
    await openFood()
    const sheet = await openAddSheet()
    fireEvent.click(within(sheet).getByRole('button', { name: /create a food/i }))
    await within(sheet).findByLabelText('Food name')
    return sheet
  }

  function fill(sheet: HTMLElement, values: Record<string, string>) {
    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(within(sheet).getByLabelText(label), { target: { value } })
    }
  }

  it('rejects negative nutrition with a visible error', async () => {
    const sheet = await openCreate()
    fill(sheet, {
      'Food name': 'Home dal',
      Calories: '-5',
      Protein: '9',
      Carbs: '24',
      Fat: '5',
      Fiber: '6',
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create food' }))
    expect(await within(sheet).findByText('Use a number with up to 2 decimals')).toBeTruthy()
    expect(submitFood).not.toHaveBeenCalled()
  })

  it('warns about a similar food but still submits a new pending food (no merge)', async () => {
    vi.mocked(searchFoods).mockResolvedValue([
      food({ id: 'curry', name: 'Chicken curry', servingUnit: 'bowl' }),
    ])
    vi.mocked(submitFood).mockResolvedValue(
      food({
        id: 'new',
        name: 'Chicken curry home',
        source: 'SUBMISSION',
        reviewStatus: 'PENDING_REVIEW',
      }),
    )
    const sheet = await openCreate()
    fill(sheet, { 'Food name': 'Chicken curry home' })
    expect(await within(sheet).findByText('A similar food already exists')).toBeTruthy()
    fill(sheet, {
      Unit: 'bowl',
      Calories: '400',
      Protein: '20',
      Carbs: '12',
      Fat: '28',
      Fiber: '2',
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create food' }))
    await waitFor(() => {
      expect(submitFood).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({ name: 'Chicken curry home', calories: 400, servingUnit: 'bowl' }),
      )
    })
    // Straight on to its quantity, clearly marked as pending.
    expect(await within(sheet).findByLabelText('Quantity')).toBeTruthy()
    expect(within(sheet).getByText('Pending review')).toBeTruthy()
  })

  it('lists the user’s submitted foods with their review status', async () => {
    vi.mocked(fetchMySubmissions).mockResolvedValue([
      {
        id: 's1',
        name: 'Home poha',
        servingQuantity: 1,
        servingUnit: 'plate',
        calories: 250,
        proteinG: 5,
        carbsG: 45,
        fatG: 6,
        fiberG: 3,
        status: 'PENDING_REVIEW',
        createdAt: '2026-09-23T10:00:00Z',
      },
      {
        id: 's2',
        name: 'Ragi malt',
        servingQuantity: 1,
        servingUnit: 'cup',
        calories: 150,
        proteinG: 4,
        carbsG: 28,
        fatG: 2,
        fiberG: 3,
        status: 'REJECTED',
        createdAt: '2026-09-22T10:00:00Z',
      },
    ])
    await openFood()
    const section = closest(await screen.findByText('My foods'), 'section')
    expect(within(section).getByText('Pending review')).toBeTruthy()
    expect(within(section).getByText('Rejected')).toBeTruthy()
  })
})
