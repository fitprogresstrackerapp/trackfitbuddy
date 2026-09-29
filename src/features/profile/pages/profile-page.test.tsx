import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'
import {
  fetchMonthlyFeedback,
  fetchRecommendationHistory,
  saveMonthlyFeedback,
} from '@/features/recommendations/api/recommendation-data'
import type * as RecommendationData from '@/features/recommendations/api/recommendation-data'
import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'

import {
  fetchInbodyReports,
  fetchPlan,
  fetchProfileDetails,
  fetchRecentSteps,
  fetchWeights,
  logSteps,
  logWeight,
  reviewRecommendation,
  saveGoal,
  updateCapacity,
  updateLifestyle,
  updatePersonal,
  type PlanData,
  type ProfileDetails,
  type Recommendation,
} from '../api/profile-data'
import type * as ProfileData from '../api/profile-data'
import { ProfilePage } from './profile-page'

vi.mock('../api/profile-data', async (importOriginal) => {
  const actual = await importOriginal<typeof ProfileData>()
  return {
    ...actual,
    fetchProfileDetails: vi.fn(),
    fetchWeights: vi.fn(),
    fetchRecentSteps: vi.fn(),
    fetchInbodyReports: vi.fn(),
    fetchPlan: vi.fn(),
    updatePersonal: vi.fn(),
    updateHeight: vi.fn(),
    updateLifestyle: vi.fn(),
    updateCapacity: vi.fn(),
    logWeight: vi.fn(),
    updateWeight: vi.fn(),
    deleteWeight: vi.fn(),
    logSteps: vi.fn(),
    deleteSteps: vi.fn(),
    uploadInbodyReport: vi.fn(),
    saveGoal: vi.fn(),
    reviewRecommendation: vi.fn(),
    acceptRecommendation: vi.fn(),
  }
})
vi.mock('@/features/recommendations/api/recommendation-data', async (importOriginal) => {
  const actual = await importOriginal<typeof RecommendationData>()
  return {
    ...actual,
    fetchMonthlyFeedback: vi.fn(),
    fetchRecommendationHistory: vi.fn(),
    saveMonthlyFeedback: vi.fn(),
  }
})
vi.mock('@/features/home/api/home-data', () => ({
  fetchHomePlan: vi.fn(),
  fetchHomeNutrition: vi.fn(),
  fetchHomeTraining: vi.fn(),
}))

const TODAY = '2026-09-29'
const NOW = new Date('2026-09-29T04:30:00Z')

const DETAILS: ProfileDetails = {
  name: 'Asha',
  dateOfBirth: '1994-05-17',
  gender: 'FEMALE',
  heightCm: 165,
  activityLevel: null,
  job: null,
  hobbies: null,
  workoutDaysPerWeek: 4,
  phone: '+919876543210',
  timezone: 'Asia/Kolkata',
}

const RECOMMENDATION: Recommendation = {
  id: 'c1',
  status: 'IN_REVIEW',
  periodStart: TODAY,
  periodEnd: null,
  reviewDeadline: '2026-09-30',
  capacity: 3,
  recommended: { calories: 2000, proteinG: 140, carbsG: 230, fatG: 65, fiberG: 30 },
  final: { calories: 2000, proteinG: 140, carbsG: 230, fatG: 65, fiberG: 30 },
  sessions: ['Upper body', 'Lower body', 'Full body'],
  originalSessions: ['Upper body', 'Lower body', 'Full body'],
  summary: 'Keep protein high.',
  goal: {
    longTermGoal: 'FAT_LOSS',
    description: null,
    effectiveFrom: '2026-09-01',
    focuses: ['MUSCLE_BUILDING'],
  },
}

const PLAN: PlanData = {
  activeGoal: {
    longTermGoal: 'FAT_LOSS',
    description: 'Lean out',
    effectiveFrom: '2026-09-01',
    focuses: ['MUSCLE_BUILDING'],
  },
  recommendation: RECOMMENDATION,
}

const OPEN_FEEDBACK = {
  month: '2026-09-01',
  feedback: null,
  updatedAt: null,
  locked: false,
  processed: false,
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

async function openProfile() {
  renderApp({ path: '/profile', state: signedIn() })
  await screen.findByRole('heading', { level: 1, name: 'Asha' })
  await waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
}

async function openSheet(sectionName: string, button: RegExp) {
  fireEvent.click(within(section(sectionName)).getByRole('button', { name: button }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchProfileDetails).mockResolvedValue(DETAILS)
  vi.mocked(fetchWeights).mockResolvedValue({
    current: { id: 'w2', date: TODAY, weightKg: 62.4, source: 'MANUAL' },
    recent: [
      { id: 'w2', date: TODAY, weightKg: 62.4, source: 'MANUAL', createdAt: `${TODAY}T05:00:00Z` },
      {
        id: 'w1',
        date: '2026-09-26',
        weightKg: 63.0,
        source: 'INBODY',
        createdAt: '2026-09-26T05:00:00Z',
      },
    ],
  })
  vi.mocked(fetchRecentSteps).mockResolvedValue([])
  vi.mocked(fetchInbodyReports).mockResolvedValue([])
  vi.mocked(fetchPlan).mockResolvedValue(PLAN)
  vi.mocked(fetchMonthlyFeedback).mockResolvedValue(OPEN_FEEDBACK)
  vi.mocked(fetchRecommendationHistory).mockResolvedValue([
    {
      id: 'c2',
      periodStart: TODAY,
      periodEnd: null,
      reviewDeadline: '2026-09-30',
      status: 'IN_REVIEW',
    },
    {
      id: 'c1',
      periodStart: '2026-08-04',
      periodEnd: '2026-09-28',
      reviewDeadline: '2026-08-05',
      status: 'LOCKED',
    },
  ])
  vi.mocked(saveMonthlyFeedback).mockResolvedValue()
  for (const fn of [
    updatePersonal,
    updateLifestyle,
    updateCapacity,
    logWeight,
    logSteps,
    saveGoal,
    reviewRecommendation,
  ]) {
    vi.mocked(fn).mockResolvedValue()
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Profile page', () => {
  it('shows a complete profile with derived age and optional fields left unset', async () => {
    await openProfile()
    expect(screen.getByText('Profile complete')).toBeTruthy()
    const personal = section('Personal')
    expect(personal.textContent).toContain('Age 32')
    expect(personal.textContent).toContain('Female')
    const lifestyle = section('Lifestyle')
    expect(within(lifestyle).getAllByText('Not set')).toHaveLength(3)
    expect(section('Body').textContent).toContain('165 cm')
  })

  it('an incomplete profile lists exactly the missing required fields', async () => {
    const account = makeAccount({ complete: false, basicsSaved: true })
    const value: AuthContextValue = {
      state: { status: 'signed_in', userId: account.profile.id, account },
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshAccount: vi.fn().mockResolvedValue(undefined),
    }
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthContext.Provider value={value}>
          <MemoryRouter>
            <ProfilePage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Profile incomplete')).toBeTruthy()
    expect(screen.getByText('2 required fields remaining')).toBeTruthy()
    expect(screen.getByText('Complete these required fields: Height, Current weight.')).toBeTruthy()
  })

  it('edits personal details with the onboarding validation', async () => {
    await openProfile()
    const sheet = await openSheet('Personal', /edit/i)
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Asha Rao' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updatePersonal).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
        name: 'Asha Rao',
        dateOfBirth: '1994-05-17',
        gender: 'FEMALE',
      })
    })
  })

  it('edits lifestyle; blanks stay optional', async () => {
    await openProfile()
    const sheet = await openSheet('Lifestyle', /edit/i)
    fireEvent.change(within(sheet).getByLabelText('Job (optional)'), {
      target: { value: 'Engineer' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateLifestyle).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
        activityLevel: null,
        job: 'Engineer',
        hobbies: null,
      })
    })
  })
})

describe('Goals and training', () => {
  it('edits goals for the next recommendation; the current plan keeps its own', async () => {
    await openProfile()
    expect(section('Goals & training').textContent).toContain(
      'keeps its goals and 3 workout days / week. Changes here apply to your next recommendation.',
    )
    const sheet = await openSheet('Goals & training', /edit goals/i)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Muscle gain' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Endurance' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cricket performance' }))
    fireEvent.change(within(sheet).getByLabelText('Objective (optional)'), {
      target: { value: 'Stronger for cricket' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save goals' }))
    await waitFor(() => {
      expect(saveGoal).toHaveBeenCalledWith(expect.anything(), {
        longTermGoal: 'MUSCLE_GAIN',
        focuses: ['MUSCLE_BUILDING', 'ENDURANCE', 'CRICKET_PERFORMANCE'],
        objective: 'Stronger for cricket',
      })
    })
  })

  it('the capacity preference says the current plan is unchanged', async () => {
    await openProfile()
    fireEvent.click(within(section('Goals & training')).getByRole('button', { name: 'Edit' }))
    const sheet = await screen.findByRole('dialog')
    expect(
      within(sheet).getByText('Your current recommendation keeps 3 days / week until it ends.'),
    ).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('radio', { name: '5' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateCapacity).toHaveBeenCalledWith(expect.anything(), expect.any(String), 5)
    })
  })
})

describe('Body and steps', () => {
  it('weight history: latest marked current, past locked, today editable', async () => {
    await openProfile()
    const body = section('Body')
    expect(body.textContent).toContain('62.4 kg')
    expect(within(body).getByText('Current')).toBeTruthy()
    expect(within(body).getByRole('button', { name: 'Edit 62.4 kg' })).toBeTruthy()
    expect(within(body).queryByRole('button', { name: 'Edit 63 kg' })).toBeNull()
    expect(within(body).getAllByLabelText('Locked')).toHaveLength(1)
  })

  it('adds a weight; future dates are rejected; past dates warn about locking', async () => {
    await openProfile()
    const sheet = await openSheet('Body', /update weight/i)
    fireEvent.change(within(sheet).getByLabelText('Weight'), { target: { value: '61.8' } })
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-09-30' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByText('The date can’t be in the future')).toBeTruthy()
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-09-27' } })
    expect(within(sheet).getByText('Locked once saved')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(logWeight).toHaveBeenCalledWith(expect.anything(), {
        weightKg: 61.8,
        date: '2026-09-27',
      })
    })
  })

  it('steps: the latest entry is the value, earlier entries are kept, nothing is summed', async () => {
    vi.mocked(fetchRecentSteps).mockResolvedValue([
      { id: 's2', date: TODAY, steps: 8420, isActive: true, createdAt: `${TODAY}T12:00:00Z` },
      { id: 's1', date: TODAY, steps: 4000, isActive: false, createdAt: `${TODAY}T05:00:00Z` },
      {
        id: 's0',
        date: '2026-09-27',
        steps: 7812,
        isActive: true,
        createdAt: '2026-09-27T12:00:00Z',
      },
    ])
    await openProfile()
    const steps = section('Steps')
    expect(steps.textContent).toContain('8,420')
    expect(steps.textContent).not.toContain('12,420')
    expect(steps.textContent).toContain('2 entries')
    expect(steps.textContent).toContain('Earlier entry')
    expect(steps.textContent).toContain('7,812')
    expect(steps.textContent).toContain('—') // a day without an entry
    expect(steps.textContent).not.toMatch(/\/\s*10,000/)
  })

  it('no steps today is shown as missing, and entries are validated', async () => {
    await openProfile()
    expect(section('Steps').textContent).toContain('No entry today')
    const sheet = await openSheet('Steps', /update steps/i)
    fireEvent.change(within(sheet).getByLabelText('Steps'), { target: { value: '12.5' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByText('Use a whole number of steps')).toBeTruthy()
    fireEvent.change(within(sheet).getByLabelText('Steps'), { target: { value: '8420' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(logSteps).toHaveBeenCalledWith(expect.anything(), { steps: 8420, date: TODAY })
    })
  })

  it('InBody: empty state, then stored metrics only', async () => {
    await openProfile()
    expect(section('InBody').textContent).toContain('No InBody reports yet')
    cleanup()
    vi.mocked(fetchInbodyReports).mockResolvedValue([
      {
        id: 'r1',
        date: '2026-09-02',
        status: 'COMPLETED',
        filePath: 'u/r1.pdf',
        fileType: 'application/pdf',
        metrics: {
          weightKg: 75.2,
          bodyFatPercent: 22.4,
          muscleMassKg: 32.1,
          bmi: null,
          bmrKcal: null,
        },
      },
      {
        id: 'r2',
        date: '2026-09-20',
        status: 'PENDING',
        filePath: 'u/r2.pdf',
        fileType: 'application/pdf',
        metrics: null,
      },
    ])
    await openProfile()
    const inbody = section('InBody')
    expect(inbody.textContent).toContain('22.4%')
    expect(inbody.textContent).toContain('32.1 kg')
    expect(inbody.textContent).not.toContain('BMI')
    expect(inbody.textContent).toContain('Awaiting results')
  })
})

describe('Current plan', () => {
  it('no recommendation is never invented', async () => {
    vi.mocked(fetchPlan).mockResolvedValue({ activeGoal: null, recommendation: null })
    await openProfile()
    expect(section('Current plan').textContent).toContain('No current recommendation')
    expect(within(section('Current plan')).queryByRole('button', { name: /review/i })).toBeNull()
  })

  it('in review: targets can be reviewed with the warning shown', async () => {
    await openProfile()
    const plan = section('Current plan')
    expect(plan.textContent).toContain('In review until SEP 30')
    const sheet = await openSheet('Current plan', /review targets/i)
    expect(
      within(sheet).getByText(
        'Recommended target — change only if advised by your nutritionist or coach.',
      ),
    ).toBeTruthy()
    fireEvent.change(within(sheet).getByLabelText('Calories'), { target: { value: '1900' } })
    fireEvent.change(within(sheet).getByLabelText('Session 1'), { target: { value: 'Push' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save targets' }))
    await waitFor(() => {
      expect(reviewRecommendation).toHaveBeenCalledWith(expect.anything(), 'c1', {
        calories: 1900,
        proteinG: 140,
        carbsG: 230,
        fatG: 65,
        fiberG: 30,
        sessions: ['Push', 'Lower body', 'Full body'],
      })
    })
  })

  it('shows final vs recommended, and is locked after the window', async () => {
    vi.mocked(fetchPlan).mockResolvedValue({
      ...PLAN,
      recommendation: {
        ...RECOMMENDATION,
        periodStart: '2026-09-25',
        reviewDeadline: '2026-09-26',
        final: { ...RECOMMENDATION.final, calories: 1900 },
      },
    })
    await openProfile()
    const plan = section('Current plan')
    expect(plan.textContent).toContain('Active')
    expect(plan.textContent).toContain('1,900 kcalEdited2,000')
    expect(within(plan).queryByRole('button', { name: /review targets/i })).toBeNull()
    expect(within(plan).queryByRole('button', { name: /accept/i })).toBeNull()
  })

  describe('monthly check-in and history', () => {
    it('saves this month’s optional check-in', async () => {
      await openProfile()
      const checkIn = section('Monthly check-in')
      expect(checkIn.textContent).toContain('Open')
      fireEvent.change(within(checkIn).getByLabelText('How did this cycle feel?'), {
        target: { value: '  The split felt hard; prefer more variety.  ' },
      })
      fireEvent.click(within(checkIn).getByRole('button', { name: 'Save feedback' }))
      await waitFor(() => {
        expect(saveMonthlyFeedback).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(String),
          '2026-09-01',
          'The split felt hard; prefer more variety.',
        )
      })
    })

    it('an empty check-in is not saved', async () => {
      await openProfile()
      const checkIn = section('Monthly check-in')
      fireEvent.click(within(checkIn).getByRole('button', { name: 'Save feedback' }))
      expect(await within(checkIn).findByText(/write a few words/i)).toBeTruthy()
      expect(saveMonthlyFeedback).not.toHaveBeenCalled()
    })

    it('shows a friendly message when the server has closed the window', async () => {
      vi.mocked(saveMonthlyFeedback).mockRejectedValue({
        code: '42501',
        message: 'The feedback window for this month has closed',
      })
      await openProfile()
      const checkIn = section('Monthly check-in')
      fireEvent.change(within(checkIn).getByLabelText('How did this cycle feel?'), {
        target: { value: 'Late note' },
      })
      fireEvent.click(within(checkIn).getByRole('button', { name: 'Save feedback' }))
      expect(await within(checkIn).findByText('This month’s check-in is closed.')).toBeTruthy()
    })

    it('after processing, the check-in used is read-only', async () => {
      vi.mocked(fetchMonthlyFeedback).mockResolvedValue({
        ...OPEN_FEEDBACK,
        feedback: 'Prefer shorter sessions.',
        locked: true,
        processed: true,
      })
      await openProfile()
      const checkIn = section('Monthly check-in')
      expect(checkIn.textContent).toContain(
        'Your September check-in was used for your recommendation.',
      )
      expect(checkIn.textContent).toContain('Prefer shorter sessions.')
      expect(within(checkIn).queryByRole('textbox')).toBeNull()
    })

    it('once this month is processed without a check-in, it says when the next opens', async () => {
      vi.mocked(fetchMonthlyFeedback).mockResolvedValue({ ...OPEN_FEEDBACK, processed: true })
      await openProfile()
      expect(section('Monthly check-in').textContent).toContain('next check-in opens on OCT 1')
    })

    it('lists the recommendation history with simple states', async () => {
      await openProfile()
      const history = section('Recommendation history')
      const items = within(history).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('In review'),
        expect.stringContaining('Previous'),
      ])
      expect(items[0]?.textContent).toContain('SEP 29')
      expect(items[1]?.textContent).toContain('AUG 4')
    })
  })
})
