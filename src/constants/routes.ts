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
} as const

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES]
