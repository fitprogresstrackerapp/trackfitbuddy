import { Navigate, Outlet, useLocation } from 'react-router'

import { ErrorState } from '@/components/common/error-state'
import { PageLoader } from '@/components/common/loading-state'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'
import { useAuth } from '@/features/auth/auth-context'
import { hasAnyRole } from '@/features/auth/lib/roles'
import type { AppRole } from '@/features/auth/types'

/**
 * Route guards. They decide what to render; they are NOT the security
 * boundary — RLS and server functions are. A user who bypassed these would
 * still receive no data they are not allowed to read.
 */

function readReturnPath(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null
  const { from } = state
  return typeof from === 'string' && from.startsWith('/') && from !== ROUTES.login ? from : null
}

function AccountLoadError({ retry }: { retry: () => void }) {
  const { signOut } = useAuth()
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <ErrorState
        className="w-full"
        title="Couldn’t load your account"
        description="Check your connection and try again."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Log out
            </Button>
          </div>
        }
      />
    </div>
  )
}

/** Only for signed-out visitors (the login page). */
export function GuestOnly() {
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') return <PageLoader />
  if (state.status === 'signed_out') return <Outlet />
  return <Navigate to={readReturnPath(location.state) ?? ROUTES.home} replace />
}

/** Requires a session with a loaded account. */
export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') return <PageLoader />
  if (state.status === 'error') return <AccountLoadError retry={state.retry} />
  if (state.status === 'signed_out') {
    // After an explicit logout the next login starts fresh at Home; otherwise
    // (first visit, expired session) return to the requested page.
    const returnState = state.reason === 'logout' ? null : { from: location.pathname }
    return <Navigate to={ROUTES.login} replace state={returnState} />
  }
  return <Outlet />
}

/** The main application: only once mandatory onboarding is complete. */
export function RequireCompleteProfile() {
  const { state } = useAuth()
  if (state.status !== 'signed_in') return null
  if (!state.account.readiness.isComplete) return <Navigate to={ROUTES.onboarding} replace />
  return <Outlet />
}

/** Onboarding: only while the profile is incomplete. */
export function RequireIncompleteProfile() {
  const { state } = useAuth()
  if (state.status !== 'signed_in') return null
  if (state.account.readiness.isComplete) return <Navigate to={ROUTES.home} replace />
  return <Outlet />
}

/** Requires at least one of the given global roles (UI gating only). */
export function RequireRole({ roles }: { roles: readonly AppRole[] }) {
  const { state } = useAuth()
  if (state.status !== 'signed_in') return null
  if (!hasAnyRole(state.account.roles, roles)) return <Navigate to={ROUTES.home} replace />
  return <Outlet />
}
