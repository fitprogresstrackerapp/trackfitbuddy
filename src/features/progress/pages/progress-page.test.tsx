import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderApp, signedIn } from '@/test/auth-harness'

import {
  fetchBodyPeriod,
  fetchCurrentPlan,
  fetchNutritionPeriod,
  fetchStepsPeriod,
  fetchTrainingPeriod,
  type CurrentPlan,
} from '../api/progress-data'
import type { CycleInfo, NutritionPeriodData, Period, SnapshotInfo } from '../types'

vi.mock('../api/progress-data', () => ({
  fetchCurrentPlan: vi.fn(),
  fetchNutritionPeriod: vi.fn(),
  fetchTrainingPeriod: vi.fn(),
  fetchBodyPeriod: vi.fn(),
  fetchStepsPeriod: vi.fn(),
}))
vi.mock('@/features/home/api/home-data', () => ({
  fetchHomePlan: vi.fn(),
  fetchHomeNutrition: vi.fn(),
  fetchHomeTraining: vi.fn(),
}))

const TODAY = '2026-09-28' // Monday in Asia/Kolkata at NOW
const NOW = new Date('2026-09-28T04:30:00Z')

const CYCLE: CycleInfo = {
  id: 'c1',
  status: 'LOCKED',
  periodStart: '2026-09-04',
  periodEnd: null,
  reviewDeadline: '2026-09-05',
  goalId: 'g1',
  workout_days_per_week: 4,
  final_calories: 2000,
  final_protein_g: 140,
  final_carbs_g: 230,
  final_fat_g: 65,
  final_fiber_g: 30,
}

const PLAN: CurrentPlan = {
  cycle: CYCLE,
  cycleGoal: {
    longTermGoal: 'FAT_LOSS',
    description: null,
    effectiveFrom: '2026-08-01',
    focuses: ['MUSCLE_BUILDING', 'GENERAL_FITNESS'],
  },
  activeGoal: {
    longTermGoal: 'FAT_LOSS',
    description: null,
    effectiveFrom: '2026-08-01',
    focuses: ['MUSCLE_BUILDING', 'GENERAL_FITNESS'],
  },
}

function snapshots(period: Period, calories = 2000): SnapshotInfo[] {
  const list: SnapshotInfo[] = []
  for (let day = new Date(`${period.start}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    if (date > period.end) break
    list.push({
      target_date: date,
      calories,
      protein_g: 140,
      carbs_g: 230,
      fat_g: 65,
      fiber_g: 30,
      workouts_per_week: 4,
      nutrition_tolerance: 0.85,
      calorie_lower_tolerance: 0.85,
      calorie_upper_tolerance: 1.1,
    })
  }
  return list
}

function nutritionData(period: Period): NutritionPeriodData {
  return {
    days: [
      {
        date: '2026-09-20',
        calories: 2000,
        proteinG: 130,
        carbsG: 210,
        fatG: 60,
        fiberG: 25,
        itemCount: 4,
      },
      {
        date: '2026-09-25',
        calories: 1200,
        proteinG: 90,
        carbsG: 150,
        fatG: 40,
        fiberG: 12,
        itemCount: 2,
      },
    ].filter((day) => day.date >= period.start && day.date <= period.end),
    snapshots: snapshots(period),
    cycles: [CYCLE],
  }
}

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

const main = () => document.querySelector('main')?.textContent ?? ''
const section = (name: string) => {
  const heading = screen.getByRole('heading', { level: 2, name })
  const element = heading.closest('section')
  if (!element) throw new Error(`section ${name} missing`)
  return element
}

async function openProgress(path = '/progress') {
  renderApp({ path, state: signedIn() })
  await screen.findByRole('heading', { level: 1, name: 'Progress' }, { timeout: 10_000 })
  await waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
}

beforeAll(async () => {
  // The lazily loaded page pulls in the charting library; load it once up front.
  await import('./progress-page')
}, 60_000)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchCurrentPlan).mockResolvedValue(PLAN)
  vi.mocked(fetchNutritionPeriod).mockImplementation((_client, _user, period) =>
    Promise.resolve(nutritionData(period)),
  )
  vi.mocked(fetchTrainingPeriod).mockImplementation((_client, _user, period) =>
    Promise.resolve({
      fetched: { start: '2026-08-24', end: period.end },
      workouts: [
        { date: '2026-09-15', durationMinutes: 45, calories: 270 },
        { date: '2026-09-15', durationMinutes: 20, calories: 160 },
        { date: '2026-09-17', durationMinutes: 50, calories: 300 },
        { date: '2026-09-22', durationMinutes: 40, calories: 240 },
      ].filter((workout) => workout.date >= period.start),
      activities: [{ date: '2026-09-21', durationMinutes: 90, calories: 450 }],
      snapshots: snapshots({ start: '2026-09-04', end: period.end }),
      cycles: [CYCLE],
    }),
  )
  vi.mocked(fetchBodyPeriod).mockResolvedValue({
    weights: [
      { date: '2026-09-05', weightKg: 80.0, source: 'MANUAL', createdAt: '2026-09-05T08:00:00Z' },
      { date: '2026-09-26', weightKg: 78.6, source: 'INBODY', createdAt: '2026-09-26T08:00:00Z' },
    ],
    composition: [
      { date: '2026-09-06', bodyFatPercent: 24.0, muscleMassKg: 31.0 },
      { date: '2026-09-26', bodyFatPercent: 23.1, muscleMassKg: 31.6 },
    ],
  })
  vi.mocked(fetchStepsPeriod).mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Progress page', () => {
  it('defaults to 30D and labels the range', async () => {
    await openProgress()
    expect(screen.getByRole('radio', { name: '30D' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Time range')).toBeTruthy()
    expect(main()).toContain('AUG 30 – SEP 28')
    expect(fetchNutritionPeriod).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      start: '2026-08-30',
      end: TODAY,
    })
  })

  it('switching the range refetches only the range sections', async () => {
    await openProgress()
    const planCalls = vi.mocked(fetchCurrentPlan).mock.calls.length
    fireEvent.click(screen.getByRole('radio', { name: '7D' }))
    await waitFor(() => {
      expect(fetchNutritionPeriod).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
        start: '2026-09-22',
        end: TODAY,
      })
    })
    expect(fetchBodyPeriod).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      start: '2026-09-22',
      end: TODAY,
    })
    expect(vi.mocked(fetchCurrentPlan).mock.calls.length).toBe(planCalls)
  })

  it('an unknown ?range= falls back to 30D', async () => {
    await openProgress('/progress?range=2W')
    expect(screen.getByRole('radio', { name: '30D' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('Current cycle', () => {
  it('summarises the recommendation cycle separately from the range', async () => {
    await openProgress('/progress?range=7D')
    const cycle = section('Current cycle')
    expect(cycle.textContent).toContain('September progress')
    expect(cycle.textContent).toContain('Recommendation cycle · SEP 4 – ongoing')
    // Cycle metrics come from the cycle period, not the 7D range.
    expect(fetchNutritionPeriod).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      start: '2026-09-04',
      end: TODAY,
    })
    expect(cycle.textContent).toContain('Calories in range')
    expect(cycle.textContent).toContain('80 → 78.6 kg')
    expect(cycle.textContent).toContain('−1.4 kg')
    expect(cycle.textContent).toContain('24 → 23.1%')
    expect(cycle.textContent).toContain('−0.9 pp')
  })

  it('without a recommendation shows NO RECOMMENDATION and invents nothing', async () => {
    vi.mocked(fetchCurrentPlan).mockResolvedValue({
      cycle: null,
      cycleGoal: null,
      activeGoal: null,
    })
    await openProgress()
    expect(section('Current cycle').textContent).toContain('No recommendation')
    expect(section('Goals').textContent).toContain('No goals set')
  })
})

describe('Nutrition', () => {
  it('uses eligible tracked days and shows averages against historical targets', async () => {
    await openProgress()
    const nutrition = section('Nutrition')
    expect(nutrition.textContent).toContain('2 tracked days')
    expect(nutrition.textContent).toContain('1,600 kcal') // (2,000 + 1,200) / 2
    expect(nutrition.textContent).toContain('Within range on 1 of 2 eligible days (50%)')
    expect(within(nutrition).getByRole('row', { name: /protein/i }).textContent).toContain('50%')
  })

  it('no food: a compact empty state, never 0 kcal', async () => {
    vi.mocked(fetchNutritionPeriod).mockResolvedValue({ days: [], snapshots: [], cycles: [] })
    await openProgress()
    const nutrition = section('Nutrition')
    expect(nutrition.textContent).toContain('No food logged')
    expect(nutrition.textContent).not.toMatch(/\b0 kcal/)
  })

  it('a failed nutrition query leaves the other sections usable', async () => {
    vi.mocked(fetchNutritionPeriod).mockRejectedValue(new Error('network'))
    await openProgress()
    expect(section('Nutrition').textContent).toContain('Nutrition data unavailable')
    expect(section('Training').textContent).toContain('Weekly completion')
    expect(section('Body').textContent).toContain('Weight')
  })
})

describe('Training and activity', () => {
  it('counts workout days per Monday–Sunday week against capacity', async () => {
    await openProgress()
    const training = section('Training')
    const rows = within(training).getAllByRole('row')
    const text = rows.map((row) => row.textContent)
    expect(text).toContain('Sep 28 – Oct 404In progress')
    expect(text).toContain('Sep 21 – 2714')
    expect(text).toContain('Sep 14 – 2024')
    // Sep 7–13 is a full week with no workouts (0 / 4); Aug 31 – Sep 6 is the
    // partial week in which the cycle began and is not judged.
    expect(training.textContent).toContain('3 / 12')
    expect(text).toContain('Sep 7 – 1304')
    expect(text).toContain('Aug 31 – Sep 604Partial week')
    expect(training.textContent).toContain('4 sessions')
  })

  it('activities have totals but no target', async () => {
    await openProgress()
    const activity = section('Activity')
    expect(activity.textContent).toContain('1h 30m')
    expect(activity.textContent).toContain('450 kcal')
    expect(activity.textContent).not.toMatch(/\d+ \/ \d+|target met|on track/i)
    expect(activity.textContent).toContain('No step entries in this period.')
  })
})

describe('Body and goals', () => {
  it('shows real measurements with percentage-point body-fat change', async () => {
    await openProgress()
    const body = section('Body')
    expect(body.textContent).toContain('80 → 78.6 kg')
    expect(body.textContent).toContain('24 → 23.1 %')
    expect(body.textContent).toContain('−0.9 pp')
    expect(body.textContent).toContain('31 → 31.6 kg')
  })

  it('no body data: compact empty state placed after the sections with data', async () => {
    vi.mocked(fetchBodyPeriod).mockResolvedValue({ weights: [], composition: [] })
    await openProgress()
    expect(section('Body').textContent).toContain('No weight data')
    const order = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(order.indexOf('Body')).toBeGreaterThan(order.indexOf('Activity'))
    expect(main()).not.toMatch(/\b0 kg/)
  })

  it('goals show context but no invented percentage', async () => {
    await openProgress()
    const goals = section('Goals')
    expect(goals.textContent).toContain('Fat loss')
    expect(goals.textContent).toContain('Muscle building')
    expect(goals.textContent).toContain('Weight changed by −1.4 kg in the selected range.')
    expect(goals.textContent).not.toMatch(/\d+%/)
  })

  it('shows loading skeletons per section while data loads', async () => {
    vi.mocked(fetchTrainingPeriod).mockReturnValue(new Promise(() => undefined))
    renderApp({ path: '/progress', state: signedIn() })
    await screen.findByRole('heading', { level: 1, name: 'Progress' }, { timeout: 10_000 })
    await waitFor(() => {
      expect(section('Nutrition').textContent).toContain('tracked days')
    })
    expect(section('Training').querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })
})
