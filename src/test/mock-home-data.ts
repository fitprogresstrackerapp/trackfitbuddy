import { vi } from 'vitest'

/**
 * Stubs Home's and Food's data access so route/auth tests that land on those
 * pages never hit the network. Import this module at the top of such tests.
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

vi.mock('@/features/nutrition/api/targets', () => ({
  fetchTargetsForDate: vi.fn(() => Promise.resolve({ targets: null, cycle: null })),
}))

vi.mock('@/features/food/api/food-data', () => ({
  fetchDayMeals: vi.fn(() => Promise.resolve([])),
  fetchCopyCandidates: vi.fn(() => Promise.resolve([])),
  fetchFoodUsage: vi.fn(() => Promise.resolve([])),
  fetchMySubmissions: vi.fn(() => Promise.resolve([])),
  searchFoods: vi.fn(() => Promise.resolve([])),
  logMeal: vi.fn(),
  addItemsToMeal: vi.fn(),
  updateItemQuantity: vi.fn(),
  deleteItem: vi.fn(),
  deleteMeal: vi.fn(),
  updateMealCategory: vi.fn(),
  copyMeal: vi.fn(),
  submitFood: vi.fn(),
}))
