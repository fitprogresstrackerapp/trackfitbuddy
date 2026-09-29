import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/test/mock-home-data'
import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'

import {
  fetchHistory,
  fetchOverview,
  fetchUsage,
  ProcessingError,
  runProcessing,
  type AttemptRecord,
  type OverviewUser,
  type ProcessingResult,
} from '../api/admin-data'
import type * as AdminData from '../api/admin-data'

vi.mock('../api/admin-data', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminData>()
  return {
    ...actual,
    fetchOverview: vi.fn(),
    fetchUsage: vi.fn(),
    fetchHistory: vi.fn(),
    runProcessing: vi.fn(),
  }
})

const NOW = new Date('2026-10-05T04:30:00Z')

function user(overrides: Partial<OverviewUser>): OverviewUser {
  return {
    userId: 'u',
    name: 'User',
    localDate: '2026-10-05',
    processingMonth: '2026-10-01',
    missingFields: [],
    hasGoal: true,
    capacity: 4,
    lastRecommendation: null,
    latestAttemptAt: null,
    failureReason: null,
    skipReason: null,
    state: 'READY',
    ...overrides,
  }
}

const USERS: OverviewUser[] = [
  user({ userId: 'john', name: 'John' }),
  user({
    userId: 'alex',
    name: 'Alex',
    missingFields: ['height_cm', 'current_weight'],
    state: 'INCOMPLETE',
  }),
  user({
    userId: 'rohit',
    name: 'Rohit',
    lastRecommendation: '2026-10-04',
    state: 'SUCCESS',
  }),
  user({ userId: 'meera', name: 'Meera', failureReason: 'Provider rate limit', state: 'FAILED' }),
]

function attempt(index: number): AttemptRecord {
  return {
    id: `a${String(index)}`,
    userId: 'rohit',
    userName: 'Rohit',
    mode: 'PROCESS',
    attempt: 1,
    status: 'SUCCESS',
    reason: null,
    provider: 'mock',
    model: 'mock-recommender-1',
    promptVersion: 'recommendation-v1',
    inputTokens: 900,
    outputTokens: 300,
    totalTokens: 1200,
    estimatedCost: 0.21,
    actualCost: null,
    currency: 'INR',
    createdAt: '2026-10-04T05:00:00Z',
    generatedAt: '2026-10-04T05:00:02Z',
  }
}

const RESULT: ProcessingResult = {
  run_id: 'run',
  queued: 1,
  skipped_at_queue: 0,
  ignored: 0,
  batch: {
    processed: 1,
    success: 1,
    failed: 0,
    skipped: 0,
    errors: 0,
    stopped_by_budget: false,
    stopped_by_time: false,
  },
  runs: { run: 'COMPLETED' },
  pending: 0,
}

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

const section = (name: string) => {
  const element = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!element) throw new Error(`section ${name} missing`)
  return element
}

async function openPage(roles: ('ADMIN' | 'SUPER_ADMIN')[] = ['ADMIN']) {
  renderApp({
    path: '/admin/recommendations',
    state: signedIn(makeAccount({ roles: ['USER', ...roles] })),
  })
  await screen.findByRole('heading', { level: 1, name: 'Recommendations' })
  await screen.findByText('John')
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchOverview).mockResolvedValue(USERS)
  vi.mocked(fetchUsage).mockResolvedValue({
    month: '2026-10-01',
    budget: 500,
    currency: 'INR',
    estimatedSpend: 120.5,
    actualSpend: null,
    reserved: 0,
    remaining: 379.5,
    requests: 7,
    inputTokens: 60000,
    outputTokens: 24230,
    totalTokens: 84230,
    usersProcessed: 6,
    models: ['claude-opus-5'],
  })
  vi.mocked(fetchHistory).mockResolvedValue({
    rows: Array.from({ length: 20 }, (_, index) => attempt(index)),
    total: 25,
  })
  vi.mocked(runProcessing).mockResolvedValue(RESULT)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Admin recommendations page', () => {
  it('summarises states and explains readiness without body metrics', async () => {
    await openPage()
    const summary = section('Summary')
    const count = (label: string) =>
      within(summary).getByRole('button', { name: new RegExp(`^${label}`) }).textContent
    expect(count('Ready')).toBe('Ready1')
    expect(count('Incomplete')).toBe('Incomplete1')
    expect(count('Success')).toBe('Success1')
    expect(count('Failed')).toBe('Failed1')
    expect(count('Pending')).toBe('Pending0')

    const users = section('Users')
    const row = (name: string) => within(users).getByText(name).closest('tr')?.textContent ?? ''
    expect(row('John')).toContain('Profile complete')
    expect(row('John')).toContain('Goals configured')
    expect(row('John')).toContain('No previous recommendation')
    expect(row('Alex')).toContain('Missing: Height, Current weight')
    expect(row('Meera')).toContain('Provider rate limit')
    expect(row('Rohit')).toContain('OCT 4')
    expect(users.textContent).not.toMatch(/kg|body fat/i)
  })

  it('filters users by clicking a status count', async () => {
    await openPage()
    fireEvent.click(within(section('Summary')).getByRole('button', { name: /^Failed/ }))
    const users = section('Users')
    expect(within(users).getByText('Meera')).toBeTruthy()
    expect(within(users).queryByText('John')).toBeNull()
  })

  it('processes all ready users with a command only', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Process all ready (1)' }))
    await waitFor(() => {
      expect(runProcessing).toHaveBeenCalledWith(expect.anything(), {
        action: 'start',
        mode: 'PROCESS',
        process_all_ready: true,
      })
    })
    expect(await screen.findByText(/1 successful · 0 failed · 0 skipped/)).toBeTruthy()
  })

  it('processes selected users and retries failed ones', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select John' }))
    fireEvent.click(screen.getByRole('button', { name: 'Process selected (1)' }))
    await waitFor(() => {
      expect(runProcessing).toHaveBeenCalledWith(expect.anything(), {
        action: 'start',
        mode: 'PROCESS',
        user_ids: ['john'],
      })
    })
    await screen.findByText(/successful/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (1)' }))
    await waitFor(() => {
      expect(runProcessing).toHaveBeenCalledWith(expect.anything(), {
        action: 'start',
        mode: 'RETRY',
        user_ids: ['meera'],
      })
    })
  })

  it('reprocess is explicit and needs confirmation', async () => {
    await openPage()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rohit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reprocess selected (1)' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('previous recommendation is kept in history')
    expect(runProcessing).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reprocess' }))
    await waitFor(() => {
      expect(runProcessing).toHaveBeenCalledWith(expect.anything(), {
        action: 'start',
        mode: 'REPROCESS',
        user_ids: ['rohit'],
      })
    })
  })

  it('keeps processing the next batch while users are pending, and reports a budget stop', async () => {
    vi.mocked(runProcessing)
      .mockResolvedValueOnce({ ...RESULT, pending: 3 })
      .mockResolvedValueOnce({
        ...RESULT,
        run_id: null,
        queued: 0,
        pending: 2,
        batch: { ...RESULT.batch, stopped_by_budget: true },
      })
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Process all ready (1)' }))
    expect(await screen.findByText('Monthly AI budget reached')).toBeTruthy()
    expect(runProcessing).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runProcessing).mock.calls[1]?.[1]).toEqual({ action: 'continue' })
    expect(screen.getByText(/2 successful · 0 failed · 0 skipped · 2 pending/)).toBeTruthy()
  })

  it('shows server refusals as plain messages', async () => {
    vi.mocked(runProcessing).mockRejectedValue(new ProcessingError('BUDGET_NOT_CONFIGURED'))
    await openPage()
    fireEvent.click(screen.getByRole('button', { name: 'Process all ready (1)' }))
    expect(await screen.findByText('Set a monthly AI budget before processing.')).toBeTruthy()
  })

  it('shows AI usage against the budget in the configured currency', async () => {
    await openPage()
    const usage = section('AI usage')
    await within(usage).findByText('Monthly budget')
    expect(usage.textContent).toContain('₹500.00')
    expect(usage.textContent).toContain('₹120.50')
    expect(usage.textContent).toContain('₹379.50')
    expect(usage.textContent).toContain('84,230')
    expect(usage.textContent).toContain('estimated from the configured model pricing')
  })

  it('pages through the attempt history', async () => {
    await openPage()
    const history = section('History')
    await within(history).findByText('Page 1 of 2')
    expect(history.textContent).toContain('recommendation-v1')
    expect(history.textContent).toContain('mock / mock-recommender-1')
    fireEvent.click(within(history).getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(fetchHistory).toHaveBeenCalledWith(expect.anything(), 1)
    })
  })

  it('is not available to managers or users', async () => {
    renderApp({
      path: '/admin/recommendations',
      state: signedIn(makeAccount({ roles: ['USER', 'MANAGER'] })),
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha' })).toBeTruthy()
    expect(fetchOverview).not.toHaveBeenCalled()
  })
})
