import { vi } from 'vitest'

/**
 * Stubs Home, Food, Training and Progress data access so route/auth tests that land on those
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

vi.mock('@/features/training/api/training-data', () => ({
  fetchTrainingWeek: vi.fn(
    (_client: unknown, _user: string, week: { start: string; end: string }) =>
      Promise.resolve({ ...week, workouts: [], activities: [] }),
  ),
  fetchTrainingPlan: vi.fn(() => Promise.resolve({ capacity: null, cycle: null })),
  fetchCalorieRates: vi.fn(() =>
    Promise.resolve({ workout: { default: 6 }, activity: { default: 5 } }),
  ),
  logTraining: vi.fn(),
  updateTraining: vi.fn(),
  deleteTraining: vi.fn(),
}))

vi.mock('@/features/progress/api/progress-data', () => ({
  fetchCurrentPlan: vi.fn(() =>
    Promise.resolve({ cycle: null, cycleGoal: null, activeGoal: null }),
  ),
  fetchNutritionPeriod: vi.fn(() => Promise.resolve({ days: [], snapshots: [], cycles: [] })),
  fetchTrainingPeriod: vi.fn(
    (_client: unknown, _user: string, period: { start: string; end: string }) =>
      Promise.resolve({ fetched: period, workouts: [], activities: [], snapshots: [], cycles: [] }),
  ),
  fetchBodyPeriod: vi.fn(() => Promise.resolve({ weights: [], composition: [] })),
  fetchStepsPeriod: vi.fn(() => Promise.resolve([])),
}))
