import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppRole } from '@/features/auth/types'
import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'

import { fetchHomeNutrition, fetchHomePlan, fetchHomeTraining } from '../api/home-data'
import type { HomeNutrition, HomePlan, HomeTraining } from '../types'

vi.mock('../api/home-data', () => ({
  fetchHomePlan: vi.fn(),
  fetchHomeNutrition: vi.fn(),
  fetchHomeTraining: vi.fn(),
}))

const TODAY = '2026-09-24' // Thursday in Asia/Kolkata at the mocked time below
const NOW = new Date('2026-09-24T04:30:00Z') // 10:00 IST

const CYCLE = {
  id: 'cycle-1',
  status: 'LOCKED' as const,
  periodStart: '2026-09-04',
  reviewDeadline: '2026-09-05',
  workoutDaysPerWeek: 4,
  sessions: ['Upper body', 'Lower body', 'Pull', 'Full body'],
}

const TOTALS = {
  calories: 1450,
  proteinG: 105,
  carbsG: 180,
  fatG: 48,
  fiberG: 19,
  mealCount: 2,
  itemCount: 5,
}

const PLAN: HomePlan = {
  targets: {
    calories: 2000,
    proteinG: 140,
    carbsG: 230,
    fatG: 65,
    fiberG: 30,
    workoutsPerWeek: 4,
    tolerance: { nutrient: 0.85, calorieLower: 0.85, calorieUpper: 1.1 },
    source: 'snapshot',
  },
  cycle: CYCLE,
  goal: {
    longTermGoal: 'FAT_LOSS',
    description: null,
    focuses: ['MUSCLE_BUILDING', 'GENERAL_FITNESS'],
  },
}

const NUTRITION: HomeNutrition = { totals: TOTALS }

const TRAINING: HomeTraining = {
  steps: 6420,
  workoutsToday: [
    { id: 'w1', type: 'CHEST_TRICEPS', customName: null, durationMinutes: 52, calories: 310 },
  ],
  workoutDaysThisWeek: 3,
  week: { start: '2026-09-21', end: '2026-09-27' },
  activitiesToday: [
    { id: 'a1', type: 'CRICKET', customName: null, durationMinutes: 60, calories: 420 },
  ],
}

function mockHome(
  plan: HomePlan | Error = PLAN,
  nutrition: HomeNutrition | Error = NUTRITION,
  training: HomeTraining | Error = TRAINING,
) {
  const respond = <T,>(value: T | Error) =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  vi.mocked(fetchHomePlan).mockImplementation(() => respond(plan))
  vi.mocked(fetchHomeNutrition).mockImplementation(() => respond(nutrition))
  vi.mocked(fetchHomeTraining).mockImplementation(() => respond(training))
}

async function renderHome(roles?: AppRole[]) {
  renderApp({ path: '/', state: signedIn(makeAccount(roles ? { roles } : {})) })
  await screen.findByRole('heading', { level: 1, name: 'Asha' })
}

const section = (name: string) => {
  const heading = screen.getByRole('heading', { level: 2, name })
  const element = heading.closest('section')
  if (!element) throw new Error(`section ${name} not found`)
  return within(element)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Home with today’s data', () => {
  it('shows intake against the food target and what remains', async () => {
    mockHome()
    await renderHome()
    const nutrition = section('Nutrition')
    expect(await nutrition.findByText('1,450')).toBeTruthy()
    expect(nutrition.getByText('/ 2,000 KCAL')).toBeTruthy()
    expect(nutrition.getByText('550 kcal remaining')).toBeTruthy()
    // 1,450 is below the 85 % lower bound (1,700): no range badge, just what remains.
    expect(nutrition.queryByText('Within range')).toBeNull()
    expect(nutrition.getByText('2 meals · 5 items')).toBeTruthy()
  })

  it('marks calories within the acceptable range', async () => {
    mockHome(PLAN, { totals: { ...TOTALS, calories: 1800 } })
    await renderHome()
    expect(await screen.findByText('Within range')).toBeTruthy()
    expect(screen.getByText('200 kcal remaining')).toBeTruthy()
  })

  it('does not subtract workout or activity calories from the food target', async () => {
    mockHome()
    await renderHome()
    // 310 kcal workout + 420 kcal activity are logged; remaining is still 2000 − 1450.
    expect(await screen.findByText('550 kcal remaining')).toBeTruthy()
    expect(screen.queryByText(/net/i)).toBeNull()
  })

  it('shows each macro against its target with accessible progress', async () => {
    mockHome()
    await renderHome()
    const bar = await screen.findByRole('progressbar', { name: 'Protein' })
    expect(bar.getAttribute('aria-valuetext')).toBe('105 of 140 G')
    expect(screen.getByRole('progressbar', { name: 'Fiber' }).getAttribute('aria-valuenow')).toBe(
      '19',
    )
  })

  it('summarises steps, today’s workout, weekly days and activity', async () => {
    mockHome()
    await renderHome()
    const today = section('Today')
    expect(await today.findByText('6,420')).toBeTruthy()
    expect(today.getByText('Completed')).toBeTruthy()
    expect(today.getByText('Chest + Triceps · 52 min')).toBeTruthy()
    expect(today.getByText('3')).toBeTruthy()
    expect(today.getByText('/ 4 days this week')).toBeTruthy()
    expect(today.getByText('Cricket · 60 min')).toBeTruthy()
    expect(today.getByText('≈ 420 kcal estimated')).toBeTruthy()
  })

  it('shows the cycle focus, plan state, next session and the three actions', async () => {
    mockHome()
    await renderHome()
    const focus = section('Current focus')
    expect(await focus.findByText('Muscle building')).toBeTruthy()
    expect(focus.getByText('General fitness')).toBeTruthy()
    expect(focus.getByText('Fat loss')).toBeTruthy()
    expect(screen.getByText('Plan active')).toBeTruthy()
    expect(screen.getByText('Full body')).toBeTruthy() // 4th template session after 3 workout days
    const actions = screen.getByRole('group', { name: 'Log' })
    const links = within(actions).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Add food',
      'Add workout',
      'Add activity',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/food?add=meal',
      '/workout?add=workout',
      '/workout?add=activity',
    ])
    // Mobile: Add Food spans the full row; the secondary actions share the next row.
    expect(links[0]?.className).toContain('col-span-2')
  })
})

describe('missing and partial data', () => {
  it('never renders missing food data as zero', async () => {
    mockHome(PLAN, { totals: null })
    await renderHome()
    const nutrition = section('Nutrition')
    expect(await nutrition.findByText('Nothing logged')).toBeTruthy()
    expect(nutrition.getByText('No meals logged today')).toBeTruthy()
    expect(nutrition.queryByText('0')).toBeNull()
    for (const name of ['Calories', 'Protein', 'Carbs', 'Fat', 'Fiber']) {
      const bar = nutrition.getByRole('progressbar', { name })
      expect(bar.getAttribute('aria-valuetext')).toBe('No data')
      expect(bar.getAttribute('aria-valuenow')).toBeNull()
    }
    expect(screen.getByText('No meals logged today.')).toBeTruthy() // next action
  })

  it('shows partial logging as logged totals', async () => {
    mockHome(PLAN, {
      totals: {
        calories: 420,
        proteinG: 18,
        carbsG: 60,
        fatG: 9,
        fiberG: 4,
        mealCount: 1,
        itemCount: 2,
      },
    })
    await renderHome()
    expect(await screen.findByText('1 meal · 2 items')).toBeTruthy()
    expect(screen.getByText('1,580 kcal remaining')).toBeTruthy()
  })

  it('shows no workout neutrally, without failure language', async () => {
    mockHome(PLAN, NUTRITION, { ...TRAINING, workoutsToday: [], workoutDaysThisWeek: 2 })
    await renderHome()
    expect(await screen.findByText('No workout logged today')).toBeTruthy()
    expect(screen.queryByText(/fail|missed/i)).toBeNull()
  })

  it('shows a missing step entry as missing, not zero', async () => {
    mockHome(PLAN, NUTRITION, { ...TRAINING, steps: null })
    await renderHome()
    const today = section('Today')
    expect(await today.findByText('No entry today')).toBeTruthy()
    expect(today.queryByText('0')).toBeNull()
  })
})

describe('recommendation states', () => {
  it('has no targets or capacity without a recommendation — nothing invented', async () => {
    mockHome({ targets: null, cycle: null, goal: null })
    await renderHome()
    expect(await screen.findByText('No active recommendation')).toBeTruthy()
    expect(screen.getByText('Daily targets are not available yet.')).toBeTruthy()
    expect(screen.getByText('No recommendation available')).toBeTruthy()
    expect(screen.queryByText(/\/ 2,000/)).toBeNull()
    expect(screen.getByText('days this week')).toBeTruthy() // count without "/ n"
    expect(screen.getByText('Focus areas are set with your first recommendation.')).toBeTruthy()
    expect(screen.getByText('1,450')).toBeTruthy() // intake still shown
  })

  it('shows the review window while a new recommendation is under review', async () => {
    mockHome({
      ...PLAN,
      cycle: {
        ...CYCLE,
        status: 'IN_REVIEW',
        periodStart: '2026-09-24',
        reviewDeadline: '2026-09-25',
      },
    })
    await renderHome()
    expect(await screen.findByText('Review until SEP 25')).toBeTruthy()
    expect(screen.getByText('· Partial week')).toBeTruthy() // cycle started this Thursday
  })

  it('handles a cycle without recorded goals', async () => {
    mockHome({ ...PLAN, goal: null })
    await renderHome()
    expect(await screen.findByText('No goals are recorded for this cycle.')).toBeTruthy()
  })
})

describe('loading and errors', () => {
  it('shows skeleton loading states, not a full-page spinner', async () => {
    const never = new Promise<never>(() => undefined)
    vi.mocked(fetchHomePlan).mockReturnValue(never)
    vi.mocked(fetchHomeNutrition).mockReturnValue(never)
    vi.mocked(fetchHomeTraining).mockReturnValue(never)
    await renderHome()
    expect(screen.getByText('Loading nutrition')).toBeTruthy()
    expect(screen.getByText('Loading today’s activity')).toBeTruthy()
  })

  it('isolates a failed section and retries it', async () => {
    mockHome(PLAN, new Error('network'), TRAINING)
    await renderHome()
    expect(await screen.findByText('Couldn’t load today’s meals')).toBeTruthy()
    expect(screen.getByText('6,420')).toBeTruthy() // other sections still render
    expect(screen.getByText('Some of today’s data couldn’t be loaded.')).toBeTruthy()
    expect(section('Nutrition').queryByText('0')).toBeNull()

    vi.mocked(fetchHomeNutrition).mockResolvedValue(NUTRITION)
    fireEvent.click(section('Nutrition').getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('550 kcal remaining')).toBeTruthy()
  })
})

describe('date and identity', () => {
  it('uses the profile timezone for "today"', async () => {
    vi.setSystemTime(new Date('2026-09-23T20:00:00Z')) // still the 23rd in UTC, already the 24th in India
    mockHome()
    await renderHome()
    expect(screen.getByText('THU 24 SEP')).toBeTruthy()
    const userId = makeAccount().profile.id
    expect(fetchHomeNutrition).toHaveBeenCalledWith(expect.anything(), userId, TODAY)
    expect(fetchHomePlan).toHaveBeenCalledWith(expect.anything(), userId, TODAY)
  })

  it('always queries the signed-in user, including for admins', async () => {
    mockHome()
    await renderHome(['USER', 'ADMIN'])
    const userId = makeAccount().profile.id
    for (const fetcher of [fetchHomePlan, fetchHomeNutrition, fetchHomeTraining]) {
      expect(vi.mocked(fetcher).mock.calls.every((call) => call[1] === userId)).toBe(true)
    }
  })
})
