import { vi } from 'vitest'

/**
 * Stubs Home's data access so route/auth tests that land on Home never hit
 * the network. Import this module at the top of such tests.
 */
vi.mock('@/features/home/api/home-data', () => ({
  fetchHomePlan: vi.fn(() => Promise.resolve({ targets: null, cycle: null, goal: null })),
  fetchHomeNutrition: vi.fn(() => Promise.resolve({ totals: null })),
  fetchHomeTraining: vi.fn(() =>
    Promise.resolve({
      steps: null,
      workoutsToday: [],
      workoutDaysThisWeek: 0,
      week: { start: '2026-09-21', end: '2026-09-27' },
      activitiesToday: [],
    }),
  ),
}))
