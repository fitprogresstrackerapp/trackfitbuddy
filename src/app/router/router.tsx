import { createBrowserRouter } from 'react-router'

import { PageLoader } from '@/components/common/loading-state'
import { ROUTES } from '@/constants/routes'
import { LoginPage } from '@/features/auth/pages/login-page'
import { FoodPage } from '@/features/food/pages/food-page'
import { GroupsPage } from '@/features/groups/pages/groups-page'
import { HomePage } from '@/features/home/pages/home-page'
import { OnboardingPage } from '@/features/profile/pages/onboarding-page'
import { ProfilePage } from '@/features/profile/pages/profile-page'
import { ProgressPage } from '@/features/progress/pages/progress-page'
import { WorkoutPage } from '@/features/workout/pages/workout-page'

import { AdminLayout } from '../layouts/admin-layout'
import { AppLayout } from '../layouts/app-layout'
import { AuthLayout } from '../layouts/auth-layout'
import { RootLayout } from '../layouts/root-layout'
import { NotFoundPage } from './not-found-page'
import { RouteErrorPage } from './route-error-page'

/**
 * Route tree, grouped by access level so guards can be added per group later:
 *
 *   public  (AuthLayout)  → /login           — later: redirect if already signed in
 *   onboarding            → /onboarding      — later: requires session
 *   user    (AppLayout)   → /, /food, …      — later: requires session + complete profile
 *   admin   (AdminLayout) → /admin/*         — later: requires ADMIN / SUPER_ADMIN role
 *
 * Guards are intentionally not implemented in this phase. Access control is
 * ultimately enforced by Supabase RLS, never by routing alone.
 */
export const router = createBrowserRouter([
  {
    Component: RootLayout,
    errorElement: <RouteErrorPage />,
    HydrateFallback: PageLoader,
    children: [
      {
        Component: AuthLayout,
        children: [
          { path: ROUTES.login, Component: LoginPage },
          { path: ROUTES.onboarding, Component: OnboardingPage },
        ],
      },
      {
        Component: AppLayout,
        children: [
          { path: ROUTES.home, Component: HomePage },
          { path: ROUTES.food, Component: FoodPage },
          { path: ROUTES.workout, Component: WorkoutPage },
          { path: ROUTES.progress, Component: ProgressPage },
          { path: ROUTES.groups, Component: GroupsPage },
          { path: ROUTES.profile, Component: ProfilePage },
        ],
      },
      {
        path: ROUTES.admin,
        Component: AdminLayout,
        children: [
          {
            // Admin screens are lazy-loaded (spec §83).
            index: true,
            lazy: async () => {
              const { AdminDashboardPage } =
                await import('@/features/admin/pages/admin-dashboard-page')
              return { Component: AdminDashboardPage }
            },
          },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
