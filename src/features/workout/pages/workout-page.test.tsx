import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteTraining,
  fetchCalorieRates,
  fetchTrainingPlan,
  fetchTrainingWeek,
  logTraining,
  updateTraining,
} from '@/features/training/api/training-data'
import type { TrainingPlan, TrainingRecord } from '@/features/training/types'
import { renderApp, signedIn } from '@/test/auth-harness'

vi.mock('@/features/training/api/training-data', () => ({
  fetchTrainingWeek: vi.fn(),
  fetchTrainingPlan: vi.fn(),
  fetchCalorieRates: vi.fn(),
  logTraining: vi.fn(),
  updateTraining: vi.fn(),
  deleteTraining: vi.fn(),
}))
vi.mock('@/features/home/api/home-data', () => ({
  fetchHomePlan: vi.fn(),
  fetchHomeNutrition: vi.fn(),
  fetchHomeTraining: vi.fn(),
}))

const TODAY = '2026-09-24' // Thursday in Asia/Kolkata at NOW
const NOW = new Date('2026-09-24T04:30:00Z')
const WEEK = { start: '2026-09-21', end: '2026-09-27' }

const PLAN: TrainingPlan = {
  capacity: 4,
  cycle: {
    periodStart: '2026-09-01',
    sessions: [
      { name: 'Upper Body', durationMinutes: 45, focus: 'Strength' },
      { name: 'Lower Body', durationMinutes: null, focus: null },
      { name: 'Full Body', durationMinutes: null, focus: null },
      { name: 'Athletic', durationMinutes: null, focus: null },
    ],
  },
}

function record(overrides: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    id: 'w1',
    kind: 'workout',
    date: TODAY,
    type: 'CHEST',
    name: null,
    durationMinutes: 45,
    estimatedCalories: 270,
    manualCalories: null,
    finalCalories: 270,
    isLocked: false,
    createdAt: '2026-09-24T05:00:00Z',
    ...overrides,
  }
}

function week(workouts: TrainingRecord[] = [], activities: TrainingRecord[] = []) {
  return { ...WEEK, workouts, activities }
}

const main = () => document.querySelector('main')?.textContent ?? ''

async function openWorkout(path = '/workout') {
  renderApp({ path, state: signedIn() })
  await screen.findByRole('heading', { level: 1, name: 'Workout' })
  await waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
}

async function openForm(name: 'Log workout' | 'Log activity') {
  const [button] = screen.getAllByRole('button', { name: new RegExp(`^${name}$`, 'i') })
  if (!button) throw new Error(`${name} button missing`)
  fireEvent.click(button)
  return screen.findByRole('dialog')
}

// jsdom has no ResizeObserver; Radix Checkbox/Select measure themselves with it.
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTrainingWeek).mockResolvedValue(week())
  vi.mocked(fetchTrainingPlan).mockResolvedValue(PLAN)
  vi.mocked(fetchCalorieRates).mockResolvedValue({
    workout: { default: 6, HIIT: 10 },
    activity: { default: 5, WALKING: 4, CRICKET: 5 },
  })
  vi.mocked(logTraining).mockResolvedValue('new-id')
  vi.mocked(updateTraining).mockResolvedValue()
  vi.mocked(deleteTraining).mockResolvedValue()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Weekly capacity', () => {
  it('counts any workouts against capacity, whatever their type', async () => {
    // Template says Upper/Lower/Full/Athletic; the user did Chest, Legs and Back.
    vi.mocked(fetchTrainingWeek).mockResolvedValue(
      week([
        record({ id: 'a', date: '2026-09-21', type: 'CHEST', isLocked: true }),
        record({ id: 'b', date: '2026-09-22', type: 'LEGS', isLocked: true }),
        record({ id: 'c', date: TODAY, type: 'BACK' }),
      ]),
    )
    await openWorkout()
    expect(main()).toMatch(/Workouts this week.*3\/ 4 WORKOUTS/)
    expect(main()).toContain('Capacity 4 / week')
    expect(main()).toContain('1 session remaining')
    expect(main()).not.toMatch(/missed|failed|behind/i)
    // Guidance continues in template order and is labelled as guidance.
    expect(main()).toContain('Next guidance')
    expect(main()).toContain('Session 4 of 4')
    expect(main()).toContain('Suggestions only.')
    expect(fetchTrainingWeek).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      WEEK,
      TODAY,
    )
  })

  it('two workouts on one day are one workout day', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(
      week([record({ id: 'a' }), record({ id: 'b', type: 'CARDIO' })]),
    )
    await openWorkout()
    expect(main()).toMatch(/1\/ 4 WORKOUTS/)
    expect(main()).toContain('3 sessions remaining')
  })

  it('capacity met: no further workout is pushed', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(
      week(
        ['2026-09-21', '2026-09-22', '2026-09-23', TODAY].map((date, index) =>
          record({ id: String(index), date, isLocked: date !== TODAY }),
        ),
      ),
    )
    await openWorkout()
    expect(main()).toMatch(/4\/ 4 WORKOUTS/)
    expect(main()).toContain('Capacity met')
    expect(main()).toContain('Weekly capacity met')
    expect(main()).not.toContain('Next guidance')
  })

  it('a partial transition week is marked, not judged', async () => {
    vi.mocked(fetchTrainingPlan).mockResolvedValue({
      ...PLAN,
      cycle: { ...(PLAN.cycle ?? { sessions: [] }), periodStart: '2026-09-23' },
    })
    vi.mocked(fetchTrainingWeek).mockResolvedValue(week([record()]))
    await openWorkout()
    expect(main()).toContain('Partial week')
    expect(main()).toContain('this week isn’t judged as a full week')
    expect(main()).not.toContain('sessions remaining')
  })

  it('no workouts: — not 0; no recommendation: no invented capacity or guidance', async () => {
    vi.mocked(fetchTrainingPlan).mockResolvedValue({ capacity: null, cycle: null })
    await openWorkout()
    expect(main()).toMatch(/Workouts this week—/)
    expect(main()).toContain('No workouts logged this week')
    expect(main()).toContain('No workout capacity is set yet')
    expect(main()).toContain('No workout guidance')
    expect(main()).not.toMatch(/\/ \d+ WORKOUTS/)
    expect(main()).toContain('No workouts yet')
    expect(main()).toContain('No activities yet')
  })

  it('a failed week query shows an error, never zero', async () => {
    vi.mocked(fetchTrainingWeek).mockRejectedValue(new Error('network'))
    await openWorkout()
    expect(await screen.findByText('This week couldn’t be loaded')).toBeTruthy()
    expect(main()).not.toMatch(/Workouts this week/)
  })
})

describe('Workouts and activities', () => {
  it('lists them separately; activities never count as workouts and have no target', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(
      week(
        [record({ name: 'Push Strength', type: 'UPPER_BODY' })],
        [
          record({
            id: 'a1',
            kind: 'activity',
            type: 'CRICKET',
            durationMinutes: 90,
            estimatedCalories: 450,
            finalCalories: 620,
            manualCalories: 620,
          }),
          record({
            id: 'a2',
            kind: 'activity',
            type: 'WALKING',
            durationMinutes: 40,
            estimatedCalories: 160,
            finalCalories: 160,
          }),
        ],
      ),
    )
    await openWorkout()
    const workouts = screen.getByRole('heading', { name: 'Workouts' }).closest('section')
    const activities = screen.getByRole('heading', { name: 'Activities' }).closest('section')
    if (!workouts || !activities) throw new Error('sections missing')
    expect(within(workouts).getByText('Push Strength')).toBeTruthy()
    expect(within(workouts).getByText('Upper body')).toBeTruthy()
    expect(within(activities).getByText('Cricket')).toBeTruthy()
    expect(within(activities).getByText('1h 30m')).toBeTruthy()
    expect(activities.textContent).toContain('620 kcal')
    expect(activities.textContent).toContain('Manual')
    expect(main()).toMatch(/1\/ 4 WORKOUTS/)
    expect(main()).toMatch(/Activities2SESSIONS/)
    expect(main()).toMatch(/Activity calories780KCAL/)
    expect(main()).not.toMatch(/activity (goal|target)|on track/i)
    expect(main()).toContain('not added to your food target')
  })

  it('a locked workout stays visible, marked LOCKED, without edit or delete', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(
      week([record({ id: 'old', date: '2026-09-22', type: 'LEGS', isLocked: true })]),
    )
    await openWorkout()
    expect(screen.getByText('Legs')).toBeTruthy()
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Legs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Legs' })).toBeNull()
  })

  it('a past day notes the lock; a future date falls back to today', async () => {
    await openWorkout('/workout?date=2026-09-22')
    expect(main()).toContain('Past day · locked')
    cleanup()
    await openWorkout('/workout?date=2026-09-25')
    expect(main()).toContain('Showing today')
    expect(fetchTrainingWeek).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '2026-09-25',
    )
  })
})

describe('Logging', () => {
  it('logs a workout with a live estimate; no calories are sent', async () => {
    await openWorkout()
    const form = await openForm('Log workout')
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '45' } })
    expect(await within(form).findByText('≈ 270 kcal')).toBeTruthy()
    expect(
      within(form).getByText(
        'Estimated based on the default workout assumption. Actual expenditure may vary.',
      ),
    ).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Log workout' }))
    await waitFor(() => {
      expect(logTraining).toHaveBeenCalledWith(expect.anything(), 'workout', {
        type: 'UPPER_BODY',
        name: null,
        durationMinutes: 45,
        manualCalories: null,
        date: TODAY,
      })
    })
  })

  it('a manual calorie override is marked and sent as the override', async () => {
    await openWorkout()
    const form = await openForm('Log workout')
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Manual calorie override' }))
    fireEvent.change(await within(form).findByLabelText('Calories'), { target: { value: '350' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log workout' }))
    await waitFor(() => {
      expect(logTraining).toHaveBeenCalledWith(
        expect.anything(),
        'workout',
        expect.objectContaining({ durationMinutes: 30, manualCalories: 350 }),
      )
    })
  })

  it('validates duration and calories before saving', async () => {
    await openWorkout()
    const form = await openForm('Log workout')
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '0' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Manual calorie override' }))
    fireEvent.change(await within(form).findByLabelText('Calories'), { target: { value: '-5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log workout' }))
    expect(await within(form).findByText('Duration must be more than 0 minutes')).toBeTruthy()
    expect(within(form).getByText('Use a non-negative number with up to 1 decimal')).toBeTruthy()
    expect(logTraining).not.toHaveBeenCalled()
  })

  it('logs an activity with the activity estimate', async () => {
    await openWorkout()
    const form = await openForm('Log activity')
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '40' } })
    expect(await within(form).findByText('≈ 160 kcal')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Log activity' }))
    await waitFor(() => {
      expect(logTraining).toHaveBeenCalledWith(
        expect.anything(),
        'activity',
        expect.objectContaining({ type: 'WALKING', durationMinutes: 40 }),
      )
    })
  })

  it('a past-day entry warns that it locks once saved', async () => {
    await openWorkout('/workout?date=2026-09-23')
    const form = await openForm('Log workout')
    expect(within(form).getByText('Locked once saved')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log workout' }))
    await waitFor(() => {
      expect(logTraining).toHaveBeenCalledWith(
        expect.anything(),
        'workout',
        expect.objectContaining({ date: '2026-09-23' }),
      )
    })
  })

  it('?add=activity from Home opens the activity form', async () => {
    // The page behind an open modal is hidden from assistive tech, so wait for the form itself.
    renderApp({ path: '/workout?add=activity', state: signedIn() })
    const form = await screen.findByRole('dialog')
    expect(within(form).getByText('Log activity', { selector: 'h2' })).toBeTruthy()
  })

  it('a failed save shows a friendly message without database details', async () => {
    vi.mocked(logTraining).mockRejectedValue({
      code: 'XX000',
      message: 'new row for relation "workouts" violates check constraint',
    })
    await openWorkout()
    const form = await openForm('Log workout')
    fireEvent.change(within(form).getByLabelText('Duration'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log workout' }))
    expect(
      await within(form).findByText('Couldn’t save this workout. Please try again.'),
    ).toBeTruthy()
    expect(form.textContent).not.toMatch(/relation|constraint/)
  })
})

describe('Editing', () => {
  it('edits an editable workout (stored estimate shown until the duration changes)', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(week([record({ estimatedCalories: 260 })]))
    await openWorkout()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Chest' }))
    const form = await screen.findByRole('dialog')
    const duration = within(form).getByLabelText('Duration')
    expect((duration as HTMLInputElement).value).toBe('45')
    expect(within(form).getByText('≈ 260 kcal')).toBeTruthy()
    expect(within(form).getByLabelText('Date').hasAttribute('disabled')).toBe(true)
    fireEvent.change(duration, { target: { value: '60' } })
    expect(await within(form).findByText('≈ 360 kcal')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(updateTraining).toHaveBeenCalledWith(
        expect.anything(),
        'workout',
        'w1',
        expect.objectContaining({ type: 'CHEST', durationMinutes: 60, manualCalories: null }),
      )
    })
  })

  it('deleting asks for confirmation first', async () => {
    vi.mocked(fetchTrainingWeek).mockResolvedValue(week([record()]))
    await openWorkout()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chest' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Delete Chest?')).toBeTruthy()
    expect(deleteTraining).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete workout' }))
    await waitFor(() => {
      expect(deleteTraining).toHaveBeenCalledWith(expect.anything(), 'workout', 'w1')
    })
  })
})
