import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getSupabaseClient } from '@/lib/supabase/client'

import { AccountUnavailableError, accountQueryKey, fetchAccount } from './api/account'
import { LoginError, requestPinLogin } from './api/pin-login'
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type SignedOutReason,
} from './auth-context'

const ACCOUNT_STALE_MS = 60_000
/** Re-check account status periodically so a deactivation takes effect while idle. */
const ACCOUNT_RECHECK_MS = 5 * 60_000

/**
 * Single source of truth for session and account state.
 *
 * - Session: Supabase Auth (tokens persisted and refreshed by supabase-js).
 * - Account: profile, roles and readiness, read through RLS.
 * - Isolation: the whole query cache is cleared whenever the signed-in user
 *   changes, including sign-out, so no data survives into another session.
 * - A profile that RLS hides from its owner means the account was deactivated
 *   or deleted: the session is ended and the reason shown on the login page.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(getSupabaseClient)
  const queryClient = useQueryClient()

  const [session, setSession] = useState<Session | null>(null)
  const [sessionResolved, setSessionResolved] = useState(false)
  const [signedOutReason, setSignedOutReason] = useState<SignedOutReason | null>(null)

  const currentUserIdRef = useRef<string | null>(null)
  /** Reason for the next sign-out we initiate; `undefined` = not initiated by us. */
  const plannedSignOutReasonRef = useRef<SignedOutReason | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const applySession = (next: Session | null) => {
      if (cancelled) return
      const previousUserId = currentUserIdRef.current
      const nextUserId = next?.user.id ?? null

      if (previousUserId !== nextUserId) {
        queryClient.clear()
        currentUserIdRef.current = nextUserId

        if (nextUserId === null) {
          const planned = plannedSignOutReasonRef.current
          plannedSignOutReasonRef.current = undefined
          setSignedOutReason(planned !== undefined ? planned : previousUserId ? 'expired' : null)
        } else {
          setSignedOutReason(null)
        }
      }

      setSession(next)
      setSessionResolved(true)
    }

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      applySession(next)
    })

    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [supabase, queryClient])

  const userId = session?.user.id ?? null

  const {
    data: account,
    error: accountError,
    isError: accountFailed,
    refetch: refetchAccount,
  } = useQuery({
    queryKey: accountQueryKey(userId ?? 'signed-out'),
    queryFn: () => {
      if (!userId) throw new Error('No active session')
      return fetchAccount(supabase, userId)
    },
    enabled: userId !== null,
    staleTime: ACCOUNT_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: ACCOUNT_RECHECK_MS,
    retry: (failureCount, error) => !(error instanceof AccountUnavailableError) && failureCount < 2,
  })

  const accountUnavailable = accountError instanceof AccountUnavailableError

  useEffect(() => {
    if (!accountUnavailable) return
    plannedSignOutReasonRef.current = 'disabled'
    void supabase.auth.signOut({ scope: 'local' })
  }, [accountUnavailable, supabase])

  const state = useMemo<AuthState>(() => {
    if (!sessionResolved) return { status: 'loading' }
    if (!userId) return { status: 'signed_out', reason: signedOutReason }
    if (accountUnavailable) return { status: 'loading' } // ending the session
    if (account) return { status: 'signed_in', userId, account }
    if (accountFailed) return { status: 'error', retry: () => void refetchAccount() }
    return { status: 'loading' }
  }, [
    sessionResolved,
    userId,
    signedOutReason,
    accountUnavailable,
    account,
    accountFailed,
    refetchAccount,
  ])

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (credentials) => {
      const tokens = await requestPinLogin(credentials)
      const { error } = await supabase.auth.setSession(tokens)
      if (error) throw new LoginError('SERVER_ERROR')
    },
    [supabase],
  )

  const signOut = useCallback(async () => {
    plannedSignOutReasonRef.current = 'logout'
    await supabase.auth.signOut({ scope: 'local' })
    queryClient.clear()
  }, [supabase, queryClient])

  const refreshAccount = useCallback(async () => {
    if (!userId) return
    await queryClient.invalidateQueries({ queryKey: accountQueryKey(userId) })
  }, [queryClient, userId])

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, refreshAccount }),
    [state, signIn, signOut, refreshAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
