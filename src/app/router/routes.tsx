import type { RouteObject } from 'react-router'

import { PageLoader } from '@/components/common/loading-state'
import { ROUTES } from '@/constants/routes'
import { LoginPage } from '@/features/auth/pages/login-page'
import { ADMIN_ROLES } from '@/features/auth/lib/roles'
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
import {
  GuestOnly,
  RequireAuth,
  RequireCompleteProfile,
  RequireIncompleteProfile,
  RequireRole,
} from './guards'
import { NotFoundPage } from './not-found-page'
import { RouteErrorPage } from './route-error-page'

/**
 * Route tree, grouped by access level:
 *
 *   guest                        → /login
 *   signed in, profile incomplete → /onboarding (and nothing else)
 *   signed in, profile complete   → /, /food, /workout, /progress, /groups, /profile
 *   + ADMIN / SUPER_ADMIN         → /admin/*
 *
 * Guards only decide what to render. Data access is enforced by Supabase RLS.
 */
export const appRoutes: RouteObject[] = [
  {
    Component: RootLayout,
    errorElement: <RouteErrorPage />,
    HydrateFallback: PageLoader,
    children: [
      {
        Component: GuestOnly,
        children: [
          { Component: AuthLayout, children: [{ path: ROUTES.login, Component: LoginPage }] },
        ],
      },
      {
        Component: RequireAuth,
        children: [
          {
            Component: RequireIncompleteProfile,
            children: [
              {
                Component: AuthLayout,
                children: [{ path: ROUTES.onboarding, Component: OnboardingPage }],
              },
            ],
          },
          {
            Component: RequireCompleteProfile,
            children: [
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
                element: <RequireRole roles={ADMIN_ROLES} />,
                children: [
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
                ],
              },
            ],
          },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]
