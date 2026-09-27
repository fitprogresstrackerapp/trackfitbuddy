/** Central route paths. Import these instead of hard-coding path strings. */
export const ROUTES = {
  login: '/login',
  onboarding: '/onboarding',
  home: '/',
  food: '/food',
  workout: '/workout',
  progress: '/progress',
  groups: '/groups',
  profile: '/profile',
  admin: '/admin',
  adminUsers: '/admin/users',
  adminManagers: '/admin/managers',
  adminGroups: '/admin/groups',
  adminFoods: '/admin/foods',
  adminProcessing: '/admin/processing',
  adminAiUsage: '/admin/ai-usage',
  adminAudit: '/admin/audit',
  adminSettings: '/admin/settings',
  /** Development-only design-system showcase (not registered in production builds). */
  designSystem: '/dev/design-system',
} as const

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES]

/**
 * Entry points for logging actions. The target pages read `?add=` once their
 * logging flows exist (Food, Workout/Activity prompts); until then they open
 * the section placeholder. Activities and steps are logged from the training
 * area (spec §8 has no separate Activity section).
 */
export const ADD_ACTION_ROUTES = {
  food: `${ROUTES.food}?add=meal`,
  workout: `${ROUTES.workout}?add=workout`,
  activity: `${ROUTES.workout}?add=activity`,
} as const
