import type { RouteObject } from 'react-router'

import { PageLoader } from '@/components/common/loading-state'
import { ADMIN_NAV } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { LoginPage } from '@/features/auth/pages/login-page'
import { ADMIN_ROLES, STAFF_ROLES } from '@/features/auth/lib/roles'
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

async function loadAdminDashboard() {
  const { AdminDashboardPage } = await import('@/features/admin/pages/admin-dashboard-page')
  return { Component: AdminDashboardPage }
}

async function loadAdminUsers() {
  const { AdminUsersPage } = await import('@/features/admin/pages/admin-users-page')
  return { Component: AdminUsersPage }
}

async function loadAdminUserDetail() {
  const { AdminUserDetailPage } = await import('@/features/admin/pages/admin-user-detail-page')
  return { Component: AdminUserDetailPage }
}

async function loadAdminAudit() {
  const { AdminAuditPage } = await import('@/features/admin/pages/admin-audit-page')
  return { Component: AdminAuditPage }
}

/** Lazy page for an admin-only section (placeholder where not built yet). */
function adminSectionLoader(to: string) {
  if (to === ROUTES.adminProcessing) return loadRecommendationsAdmin
  if (to === ROUTES.adminAudit) return loadAdminAudit
  return loadAdminSection
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
                // Staff only. Users are open to managers (read-only, and the
                // database limits them to their assigned users); every other
                // admin section is ADMIN / SUPER_ADMIN only.
                element: <RequireRole roles={STAFF_ROLES} />,
                children: [
                  {
                    path: ROUTES.admin,
                    Component: AdminLayout,
                    children: [
                      { path: 'users', lazy: loadAdminUsers },
                      { path: 'users/:userId', lazy: loadAdminUserDetail },
                      {
                        element: <RequireRole roles={ADMIN_ROLES} />,
                        children: ADMIN_NAV.filter((item) => item.to !== ROUTES.adminUsers).map(
                          (item) =>
                            item.to === ROUTES.admin
                              ? { index: true, lazy: loadAdminDashboard }
                              : {
                                  path: item.to.slice(ROUTES.admin.length + 1),
                                  lazy: adminSectionLoader(item.to),
                                },
                        ),
                      },
                    ],
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
