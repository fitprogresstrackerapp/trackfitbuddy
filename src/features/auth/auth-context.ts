import { createContext, useContext } from 'react'

import type { Account } from './types'

/**
 * Why the session ended: the user logged out, the account was deactivated, or
 * the session expired. `null` = never signed in during this visit.
 */
export type SignedOutReason = 'logout' | 'disabled' | 'expired'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out'; reason: SignedOutReason | null }
  | { status: 'error'; retry: () => void }
  | { status: 'signed_in'; userId: string; account: Account }

export interface AuthContextValue {
  state: AuthState
  /** Throws `LoginError` on failure. */
  signIn: (credentials: { phone: string; pin: string }) => Promise<void>
  signOut: () => Promise<void>
  /** Re-reads profile, roles and readiness (e.g. after onboarding saves). */
  refreshAccount: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** For pages behind the auth guard: the signed-in account. */
export function useAccount(): Account {
  const { state } = useAuth()
  if (state.status !== 'signed_in') throw new Error('useAccount requires a signed-in user')
  return state.account
}
