import { render } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'

import { appRoutes } from '@/app/router/routes'
import { AuthContext, type AuthContextValue, type AuthState } from '@/features/auth/auth-context'
import type { Account, AppRole } from '@/features/auth/types'

export function makeAccount(
  options: { complete?: boolean; basicsSaved?: boolean; roles?: AppRole[] } = {},
): Account {
  const complete = options.complete ?? true
  const basics = complete || (options.basicsSaved ?? false)
  return {
    profile: {
      id: '00000000-0000-0000-0000-0000000000a1',
      phone: '+919876543210',
      name: basics ? 'Asha' : null,
      dateOfBirth: basics ? '1994-05-17' : null,
      gender: basics ? 'FEMALE' : null,
      heightCm: complete ? 165 : null,
      timezone: 'Asia/Kolkata',
    },
    roles: options.roles ?? ['USER'],
    readiness: {
      isComplete: complete,
      missingFields: complete
        ? []
        : [...(basics ? [] : ['name', 'date_of_birth', 'gender']), 'height_cm', 'current_weight'],
    },
  }
}

export const signedIn = (account: Account = makeAccount()): AuthState => ({
  status: 'signed_in',
  userId: account.profile.id,
  account,
})

export const signedOut = (reason: 'logout' | 'disabled' | 'expired' | null = null): AuthState => ({
  status: 'signed_out',
  reason,
})

interface HarnessOptions {
  path: string
  state: AuthState
  /** What a successful signIn() resolves to (default: complete user). */
  afterSignIn?: AuthState
  signInError?: Error
}

/**
 * Renders the real route tree with a controllable fake auth context, so the
 * actual guards and pages are exercised without a backend.
 */
export function renderApp({ path, state, afterSignIn, signInError }: HarnessOptions) {
  const signIn = vi.fn<AuthContextValue['signIn']>()
  const signOut = vi.fn<AuthContextValue['signOut']>()
  const refreshAccount = vi.fn<AuthContextValue['refreshAccount']>().mockResolvedValue()

  function Harness() {
    const [authState, setAuthState] = useState(state)
    const [router] = useState(() => createMemoryRouter(appRoutes, { initialEntries: [path] }))

    signIn.mockImplementation(async () => {
      if (signInError) throw signInError
      setAuthState(afterSignIn ?? signedIn())
      return Promise.resolve()
    })
    signOut.mockImplementation(async () => {
      setAuthState(signedOut('logout'))
      return Promise.resolve()
    })

    const value = useMemo<AuthContextValue>(
      () => ({ state: authState, signIn, signOut, refreshAccount }),
      [authState],
    )

    return (
      <AuthContext.Provider value={value}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    )
  }

  render(<Harness />)
  return { signIn, signOut, refreshAccount }
}
