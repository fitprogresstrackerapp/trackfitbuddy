import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/test/mock-home-data'
import type { AppRole } from '@/features/auth/types'
import { notify } from '@/lib/feedback'
import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'

import {
  approveFoodSubmission,
  approveFoodSubmissions,
  createFood,
  fetchFoodDuplicates,
  listFoods,
  rejectFoodSubmission,
  setFoodActive,
  updateFood,
  type FoodAdminRow,
} from '../api/food-admin-data'
import type * as FoodAdminData from '../api/food-admin-data'

vi.mock('../api/food-admin-data', async (importOriginal) => {
  const actual = await importOriginal<typeof FoodAdminData>()
  return {
    ...actual,
    listFoods: vi.fn(),
    fetchFoodDuplicates: vi.fn(),
    createFood: vi.fn(),
    updateFood: vi.fn(),
    setFoodActive: vi.fn(),
    approveFoodSubmission: vi.fn(),
    approveFoodSubmissions: vi.fn(),
    rejectFoodSubmission: vi.fn(),
  }
})

const FOOD: FoodAdminRow = {
  kind: 'FOOD',
  id: 'f1',
  name: 'Paneer tikka',
  servingQuantity: 100,
  servingUnit: 'g',
  calories: 300,
  proteinG: 18,
  carbsG: 6,
  fatG: 22,
  fiberG: 1,
  isApproximate: true,
  status: 'ACTIVE',
  source: 'CATALOGUE',
  submittedByName: null,
  notes: null,
  createdAt: '2026-10-01T05:00:00Z',
  updatedAt: '2026-10-02T05:00:00Z',
  version: 1,
}

const PENDING: FoodAdminRow = {
  ...FOOD,
  kind: 'SUBMISSION',
  id: 's1',
  name: 'Chicken biryani',
  servingQuantity: 1,
  servingUnit: 'plate',
  calories: 600,
  proteinG: 25,
  carbsG: 80,
  fatG: 18,
  fiberG: 3,
  status: 'PENDING_REVIEW',
  source: 'USER_SUBMISSION',
  submittedByName: 'Uma User',
  updatedAt: '2026-10-03T05:00:00Z',
  version: null,
}

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function open(path = '/admin/food', roles: AppRole[] = ['ADMIN']) {
  renderApp({ path, state: signedIn(makeAccount({ roles: ['USER', ...roles] })) })
}

/** The first matching button (table and list both render row actions). */
function firstButton(name: string): HTMLElement {
  const [button] = screen.getAllByRole('button', { name })
  if (!button) throw new Error(`no button ${name}`)
  return button
}

function firstCheckbox(name: string): HTMLElement {
  const [box] = screen.getAllByRole('checkbox', { name })
  if (!box) throw new Error(`no checkbox ${name}`)
  return box
}

async function sheet() {
  return screen.findByRole('dialog')
}

function fill(dialog: HTMLElement, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
  }
}

// A second pending food whose calories are far from its macros (25 + 2 + 1 g ≈ 117 kcal).
const ODD: FoodAdminRow = {
  ...PENDING,
  id: 's2',
  name: 'Mystery shake',
  calories: 900,
  proteinG: 25,
  carbsG: 2,
  fatG: 1,
  submittedByName: 'Ola Other',
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.mocked(listFoods).mockImplementation((_client, filters) =>
    Promise.resolve(
      filters.status === 'PENDING_REVIEW'
        ? { rows: [PENDING], total: 1 }
        : { rows: [FOOD, PENDING], total: 2 },
    ),
  )
  vi.mocked(fetchFoodDuplicates).mockResolvedValue([])
  vi.mocked(createFood).mockResolvedValue('new')
  vi.mocked(updateFood).mockResolvedValue()
  vi.mocked(setFoodActive).mockResolvedValue()
  vi.mocked(approveFoodSubmission).mockResolvedValue('f9')
  vi.mocked(approveFoodSubmissions).mockResolvedValue([])
  vi.mocked(rejectFoodSubmission).mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Admin Food Database', () => {
  it('lists foods with their serving basis, source and status, and the review queue size', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'Food Database' })
    expect((await screen.findAllByText('Paneer tikka')).length).toBeGreaterThan(0)
    const body = document.body.textContent
    expect(body).toContain('per 100 g')
    expect(body).toContain('per 1 plate')
    expect(body).toContain('Starter catalogue')
    expect(body).toContain('User-created')
    expect(body).toContain('Uma User')
    expect(body).toContain('1 food is awaiting review.')
    expect(screen.getByText('2 found')).toBeTruthy()
  })

  it('searches, filters and sorts on the server', async () => {
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'paneer' } })
    await waitFor(() => {
      expect(listFoods).toHaveBeenLastCalledWith(
        expect.anything(),
        { search: 'paneer', status: null, source: null, sort: 'NAME' },
        0,
      )
    })
  })

  it('opens the review queue from the address', async () => {
    open('/admin/food?status=PENDING_REVIEW')
    expect(await screen.findByRole('heading', { name: 'Awaiting review' })).toBeTruthy()
    await waitFor(() => {
      expect(listFoods).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'PENDING_REVIEW' }),
        0,
      )
    })
    expect(screen.queryByText(/awaiting review\.$/)).toBeNull()
  })

  it('shows the empty states', async () => {
    vi.mocked(listFoods).mockResolvedValue({ rows: [], total: 0 })
    open()
    expect(await screen.findByText('No shared foods found.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add food' }).length).toBe(2)
    cleanup()
    open('/admin/food?status=PENDING_REVIEW')
    expect(await screen.findByText('No foods awaiting review.')).toBeTruthy()
  })

  it('shows a retry when the list fails', async () => {
    vi.mocked(listFoods).mockRejectedValue(new Error('relation does not exist'))
    open()
    expect(await screen.findByText('Foods unavailable')).toBeTruthy()
    expect(document.body.textContent).not.toContain('relation')
  })

  it('is not available to a manager', async () => {
    open('/admin/food', ['MANAGER'])
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Food Database' })).toBeNull()
    })
    expect(listFoods).not.toHaveBeenCalled()
  })

  it('adds a food after validating it, and asks again when calories do not fit the macros', async () => {
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.click(firstButton('Add food'))
    const dialog = await sheet()
    fill(dialog, {
      'Food name': 'Sprouts salad',
      Calories: '150',
      Protein: '-1',
      Carbs: '20',
      Fat: '2',
      Fiber: '6',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add food' }))
    expect(await within(dialog).findByText('Use a number with up to 2 decimals')).toBeTruthy()
    expect(createFood).not.toHaveBeenCalled()

    // 10 g protein + 20 g carbs + 2 g fat ≈ 138 kcal: 900 kcal is far off.
    fill(dialog, { Protein: '10', Calories: '900' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add food' }))
    expect(await within(dialog).findByText('Check the calories')).toBeTruthy()
    expect(createFood).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => {
      expect(createFood).toHaveBeenCalledWith(expect.anything(), {
        values: {
          name: 'Sprouts salad',
          servingQuantity: 100,
          servingUnit: 'g',
          calories: 900,
          proteinG: 10,
          carbsG: 20,
          fatG: 2,
          fiberG: 6,
        },
        isApproximate: true,
        active: true,
      })
    })
    expect(createFood).toHaveBeenCalledTimes(1)
  })

  it('edits a food with the version it was opened at, and explains a stale edit', async () => {
    vi.mocked(updateFood).mockRejectedValue({ code: 'PT409', message: 'changed' })
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.click(firstButton('Edit Paneer tikka'))
    const dialog = await sheet()
    expect(dialog.textContent).toContain(
      'Meals already logged keep the values they were logged with.',
    )
    fill(dialog, { Calories: '280', Fat: '20' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(
      await within(dialog).findByText(
        'This record changed since you opened it. Refresh and try again.',
      ),
    ).toBeTruthy()
    expect(updateFood).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'f1', version: FOOD.updatedAt }),
    )
  })

  it('deactivates a food after confirmation', async () => {
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.click(firstButton('Deactivate Paneer tikka'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Meals already logged with it are kept unchanged.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => {
      expect(setFoodActive).toHaveBeenCalledWith(expect.anything(), {
        id: 'f1',
        version: FOOD.updatedAt,
        active: false,
        reason: null,
      })
    })
  })

  it('reviews a user-created food: shows what was submitted and likely duplicates, then approves', async () => {
    vi.mocked(fetchFoodDuplicates).mockResolvedValue([
      { ...FOOD, id: 'f7', name: 'Chicken biryani', status: 'ACTIVE', isExact: true },
    ])
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.click(firstButton('Review Chicken biryani'))
    const dialog = await sheet()
    expect(dialog.textContent).toContain('Uma User')
    expect(dialog.textContent).toContain('User-created (not verified)')
    expect(await within(dialog).findByText('A food with this name already exists')).toBeTruthy()
    fill(dialog, { 'Food name': 'Chicken biryani (home)' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      expect(approveFoodSubmission).toHaveBeenCalledWith(expect.anything(), {
        id: 's1',
        version: PENDING.updatedAt,
        values: expect.objectContaining({
          name: 'Chicken biryani (home)',
          calories: 600,
        }) as object,
        isApproximate: true,
        notes: null,
      })
    })
  })

  it('rejects a user-created food after confirmation', async () => {
    open()
    await screen.findAllByText('Paneer tikka')
    fireEvent.click(firstButton('Review Chicken biryani'))
    const dialog = await sheet()
    fill(dialog, { 'Review note': 'Duplicate' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(await within(dialog).findByText('Reject this food?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject food' }))
    await waitFor(() => {
      expect(rejectFoodSubmission).toHaveBeenCalledWith(expect.anything(), {
        id: 's1',
        version: PENDING.updatedAt,
        notes: 'Duplicate',
      })
    })
    expect(approveFoodSubmission).not.toHaveBeenCalled()
  })

  describe('bulk approval', () => {
    beforeEach(() => {
      vi.mocked(listFoods).mockResolvedValue({ rows: [FOOD, PENDING, ODD], total: 3 })
    })

    it('offers selection only for foods awaiting review', async () => {
      open()
      await screen.findAllByText('Paneer tikka')
      expect(
        screen.getAllByRole('checkbox', { name: 'Select Chicken biryani' }).length,
      ).toBeGreaterThan(0)
      expect(screen.queryAllByRole('checkbox', { name: 'Select Paneer tikka' })).toHaveLength(0)
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Approve selected' }).disabled,
      ).toBe(true)
    })

    it('approves the selected foods once, warns about implausible calories, and lists skipped foods', async () => {
      vi.mocked(approveFoodSubmissions).mockResolvedValue([
        { id: 's1', approved: true, message: null },
        { id: 's2', approved: false, message: 'Changed since the list was loaded' },
      ])
      const success = vi.spyOn(notify, 'success')
      open()
      await screen.findAllByText('Paneer tikka')
      fireEvent.click(screen.getByLabelText('Select all pending on this page'))
      expect(screen.getByText('2 selected')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain('Approve 2 foods?')
      expect(dialog.textContent).toContain('exactly as its user entered it')
      expect(within(dialog).getByText('Check the calories')).toBeTruthy()
      expect(dialog.textContent).toContain('Mystery shake')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))

      await waitFor(() => {
        expect(approveFoodSubmissions).toHaveBeenCalledWith(expect.anything(), {
          items: [
            { id: 's1', version: PENDING.updatedAt },
            { id: 's2', version: ODD.updatedAt },
          ],
          notes: null,
        })
      })
      expect(approveFoodSubmissions).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('1 food was not approved')).toBeTruthy()
      expect(document.body.textContent).toContain(
        'Mystery shake: Changed since the list was loaded',
      )
      expect(success).toHaveBeenCalledWith('1 food approved', 'Recorded in the audit log.')
      expect(screen.getByText('0 selected')).toBeTruthy()
    })

    it('approves one ticked food without touching the others', async () => {
      vi.mocked(approveFoodSubmissions).mockResolvedValue([
        { id: 's1', approved: true, message: null },
      ])
      open()
      await screen.findAllByText('Paneer tikka')
      fireEvent.click(firstCheckbox('Select Chicken biryani'))
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain('Approve 1 food?')
      expect(within(dialog).queryByText('Check the calories')).toBeNull()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
      await waitFor(() => {
        expect(approveFoodSubmissions).toHaveBeenCalledWith(expect.anything(), {
          items: [{ id: 's1', version: PENDING.updatedAt }],
          notes: null,
        })
      })
    })
  })
})
