import type { RouteObject } from 'react-router'

import { PageLoader } from '@/components/common/loading-state'
import { ADMIN_NAV } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { LoginPage } from '@/features/auth/pages/login-page'
import { ADMIN_ROLES } from '@/features/auth/lib/roles'
import { FoodPage } from '@/features/food/pages/food-page'
import { GroupDetailPage } from '@/features/groups/pages/group-detail-page'
import { GroupsPage } from '@/features/groups/pages/groups-page'
import { HomePage } from '@/features/home/pages/home-page'
import { OnboardingPage } from '@/features/profile/pages/onboarding-page'
import { ProfilePage } from '@/features/profile/pages/profile-page'
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

/** Progress carries the charting library, so it is loaded on demand. */
async function loadProgressPage() {
  const { ProgressPage } = await import('@/features/progress/pages/progress-page')
  return { Component: ProgressPage }
}

/** Admin screens are lazy-loaded (spec §83). */
async function loadAdminSection() {
  const { AdminSectionPage } = await import('@/features/admin/pages/admin-section-page')
  return { Component: AdminSectionPage }
}

async function loadRecommendationsAdmin() {
  const { AdminRecommendationsPage } =
    await import('@/features/recommendations/pages/admin-recommendations-page')
  return { Component: AdminRecommendationsPage }
}

/**
 * Development-only routes. `import.meta.env.DEV` is statically false in
 * production builds, so these routes and their chunks are not shipped.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: ROUTES.designSystem,
        lazy: async () => {
          const { DesignSystemPage } = await import('@/features/design-system/design-system-page')
          return { Component: DesignSystemPage }
        },
      },
    ]
  : []

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
                  { path: ROUTES.progress, lazy: loadProgressPage },
                  { path: ROUTES.groups, Component: GroupsPage },
                  { path: `${ROUTES.groups}/:groupId`, Component: GroupDetailPage },
                  { path: ROUTES.profile, Component: ProfilePage },
                ],
              },
              {
                element: <RequireRole roles={ADMIN_ROLES} />,
                children: [
                  {
                    path: ROUTES.admin,
                    Component: AdminLayout,
                    children: ADMIN_NAV.map((item) =>
                      item.to === ROUTES.admin
                        ? { index: true, lazy: loadAdminSection }
                        : {
                            path: item.to.slice(ROUTES.admin.length + 1),
                            lazy:
                              item.to === ROUTES.adminProcessing
                                ? loadRecommendationsAdmin
                                : loadAdminSection,
                          },
                    ),
                  },
                ],
              },
            ],
          },
        ],
      },
      ...devRoutes,
      { path: '*', Component: NotFoundPage },
    ],
  },
]
