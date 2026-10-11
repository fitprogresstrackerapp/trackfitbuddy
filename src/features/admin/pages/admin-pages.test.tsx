import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/test/mock-home-data'
import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'
import type { AppRole } from '@/features/auth/types'

import {
  applyCorrection,
  fetchActiveGoal,
  fetchAudit,
  fetchBodyRecords,
  fetchDashboard,
  fetchDayRecords,
  fetchRecommendationCycles,
  fetchUserAccount,
  listUsers,
  setUserActive,
  type AuditEntry,
  type UserAccount,
  type UserRow,
} from '../api/admin-data'
import type * as AdminData from '../api/admin-data'

vi.mock('../api/admin-data', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminData>()
  return {
    ...actual,
    listUsers: vi.fn(),
    fetchUserAccount: vi.fn(),
    fetchDayRecords: vi.fn(),
    fetchBodyRecords: vi.fn(),
    fetchRecommendationCycles: vi.fn(),
    fetchActiveGoal: vi.fn(),
    fetchAudit: vi.fn(),
    fetchDashboard: vi.fn(),
    setUserActive: vi.fn(),
    applyCorrection: vi.fn(),
    resetPin: vi.fn(),
    createUser: vi.fn(),
  }
})

const USER_ID = '00000000-0000-0000-0000-00000000d001'

const ROW: UserRow = {
  userId: USER_ID,
  name: 'Uma User',
  phone: '+919430000005',
  roles: ['USER'],
  isActive: true,
  isProfileComplete: true,
  missingFields: [],
  recommendationStatus: 'ACTIVE',
  lastActivity: '2026-09-30',
  createdAt: '2026-08-01T00:00:00Z',
}

const ACCOUNT: UserAccount = {
  userId: USER_ID,
  name: 'Uma User',
  phone: '+919430000005',
  roles: ['USER'],
  isActive: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  deactivatedAt: null,
  deactivatedByName: null,
  timezone: 'Asia/Kolkata',
  dateOfBirth: '1995-04-02',
  gender: 'FEMALE',
  heightCm: 160,
  activityLevel: null,
  job: null,
  hobbies: null,
  workoutDaysPerWeek: 4,
  missingFields: [],
  recommendationStatus: 'ACTIVE',
  lastActivity: '2026-09-30',
  canAdminister: true,
}

const CORRECTION: AuditEntry = {
  id: 'audit-1',
  createdAt: '2026-09-30T10:00:00Z',
  actorId: 'a',
  actorName: 'Ada Admin',
  targetId: USER_ID,
  targetName: 'Uma User',
  entityType: 'steps_entries',
  entityId: 's1',
  action: 'ADMIN_CORRECTION',
  reason: 'Tracker double-counted',
  oldValues: { steps: 800, updated_at: 'x' },
  newValues: { steps: 8000, updated_at: 'y' },
}

function open(path: string, roles: AppRole[] = ['ADMIN']) {
  renderApp({ path, state: signedIn(makeAccount({ roles: ['USER', ...roles] })) })
}

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.mocked(listUsers).mockResolvedValue({ rows: [ROW], total: 1 })
  vi.mocked(fetchUserAccount).mockResolvedValue(ACCOUNT)
  vi.mocked(fetchDayRecords).mockResolvedValue({
    meals: [],
    workouts: [],
    activities: [],
    steps: [
      {
        id: 's1',
        steps: 800,
        isActive: true,
        createdAt: '2026-10-01T05:00:00Z',
        updatedAt: '2026-10-01T05:00:00Z',
      },
    ],
    totals: null,
    target: null,
  })
  vi.mocked(fetchBodyRecords).mockResolvedValue({ weights: [], inbody: [] })
  vi.mocked(fetchRecommendationCycles).mockResolvedValue([])
  vi.mocked(fetchActiveGoal).mockResolvedValue(null)
  vi.mocked(fetchAudit).mockResolvedValue({ rows: [CORRECTION], total: 1 })
  vi.mocked(fetchDashboard).mockResolvedValue({
    activeUsers: 12,
    inactiveUsers: 1,
    incompleteProfiles: 2,
    recommendationsInReview: 3,
    recommendationsPending: 0,
    recommendationFailures: 1,
    activeGroups: 4,
    foodSubmissionsPending: 0,
    aiSpend: 120,
    aiBudget: null,
    aiCurrency: 'INR',
  })
  vi.mocked(applyCorrection).mockResolvedValue()
  vi.mocked(setUserActive).mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Admin users', () => {
  it('lists users with status badges; admins can create users', async () => {
    open('/admin/users')
    await screen.findByRole('heading', { level: 1, name: 'Users' })
    expect((await screen.findAllByText('Uma User')).length).toBeGreaterThan(0)
    expect(screen.getByText('1 found')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create user' })).toBeTruthy()
  })

  it('searches on the server', async () => {
    open('/admin/users')
    await screen.findAllByText('Uma User')
    fireEvent.change(screen.getByLabelText('Name or phone'), { target: { value: '94300' } })
    await waitFor(() => {
      expect(listUsers).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ search: '94300' }),
        0,
      )
    })
  })

  it('managers see their assigned users without create', async () => {
    open('/admin/users', ['MANAGER'])
    await screen.findAllByText('Uma User')
    expect(screen.getByText(/Users assigned to you/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create user' })).toBeNull()
  })

  it('shows retry when the list fails', async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error('down'))
    open('/admin/users')
    expect(await screen.findByText('Users unavailable')).toBeTruthy()
  })
})

describe('Admin user detail', () => {
  it('shows account, profile and records with admin actions', async () => {
    open(`/admin/users/${USER_ID}`)
    await screen.findByRole('heading', { level: 1, name: 'Uma User' })
    expect(screen.getByRole('button', { name: 'Reset PIN' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeTruthy()
    expect(screen.getByText('160 cm')).toBeTruthy()
    expect(screen.getByText('4 days / week')).toBeTruthy()
    expect(await screen.findByText('Tracker double-counted', { exact: false })).toBeTruthy()
  })

  it('corrects steps: original, corrected, reason, explicit confirm', async () => {
    open(`/admin/users/${USER_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Correct steps 800' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('region', { name: 'Original' }).textContent).toContain('800')
    fireEvent.change(within(dialog).getByLabelText('Steps'), { target: { value: '8000' } })
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: 'Tracker double-counted' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review correction' }))
    expect(applyCorrection).not.toHaveBeenCalled()
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Apply correction' }))
    await waitFor(() => {
      expect(applyCorrection).toHaveBeenCalledWith(
        expect.anything(),
        { domain: 'steps', id: 's1', version: '2026-10-01T05:00:00Z', steps: 8000 },
        'Tracker double-counted',
      )
    })
  })

  it('deactivates only after confirmation', async () => {
    open(`/admin/users/${USER_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Nothing is deleted/)
    expect(setUserActive).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => {
      expect(setUserActive).toHaveBeenCalledWith(expect.anything(), USER_ID, false, null)
    })
  })

  it('is read-only when the server says so (manager)', async () => {
    vi.mocked(fetchUserAccount).mockResolvedValue({ ...ACCOUNT, canAdminister: false })
    open(`/admin/users/${USER_ID}`, ['MANAGER'])
    await screen.findByRole('heading', { level: 1, name: 'Uma User' })
    expect(await screen.findByText(/Read-only/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset PIN' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Correct / })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Audit history' })).toBeNull()
  })

  it('an out-of-scope user looks unavailable', async () => {
    vi.mocked(fetchUserAccount).mockRejectedValue({ code: '42501', message: 'denied' })
    open(`/admin/users/${USER_ID}`, ['MANAGER'])
    expect(await screen.findByText('This user isn’t available')).toBeTruthy()
  })
})

describe('Admin audit and dashboard', () => {
  it('lists audit entries and opens field-level detail', async () => {
    open('/admin/audit')
    await screen.findByRole('heading', { level: 1, name: 'Audit Logs' })
    fireEvent.click(await screen.findByRole('button', { name: /Admin correction/ }))
    const dialog = await screen.findByRole('dialog')
    const row = within(dialog).getByRole('cell', { name: 'steps' }).closest('tr')
    expect(row?.textContent).toBe('steps8008000')
    expect(dialog.textContent).toContain('Ada Admin')
    expect(dialog.textContent).toContain('Tracker double-counted')
    expect(dialog.textContent).not.toContain('updated at')
  })

  it('filters audit by action on the server', async () => {
    open('/admin/audit')
    await screen.findByRole('button', { name: /Admin correction/ })
    fireEvent.change(screen.getByLabelText('Actor name'), { target: { value: 'Ada' } })
    await waitFor(() => {
      expect(fetchAudit).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ actor: 'Ada' }),
        0,
        25,
      )
    })
  })

  it('shows a concise dashboard', async () => {
    open('/admin')
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    expect((await screen.findByText('Active users')).closest('div')?.textContent).toBe(
      'Active users12',
    )
    expect(screen.getByText('Not set')).toBeTruthy()
  })

  it('managers cannot open admin-only sections', async () => {
    open('/admin/audit', ['MANAGER'])
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Audit Logs' })).toBeNull()
    })
    expect(fetchAudit).not.toHaveBeenCalled()
  })
})
