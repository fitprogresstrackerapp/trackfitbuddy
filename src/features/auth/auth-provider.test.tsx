import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccount } from '@/test/auth-harness'

import type * as AccountApi from './api/account'
import { AccountUnavailableError, fetchAccount } from './api/account'
import { useAuth } from './auth-context'
import { AuthProvider } from './auth-provider'

/*
 * Session edge cases: whatever ends a session — logout, an expired refresh
 * token, a deactivated account, another user signing in — no cached private
 * data may survive into the next state.
 */

type Listener = (event: string, session: Session | null) => void

const auth = {
  listener: null as Listener | null,
  session: null as Session | null,
  getSession: vi.fn(() => Promise.resolve({ data: { session: auth.session } })),
  onAuthStateChange: vi.fn((listener: Listener) => {
    auth.listener = listener
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  }),
  signOut: vi.fn(() => {
    auth.session = null
    auth.listener?.('SIGNED_OUT', null)
    return Promise.resolve({ error: null })
  }),
  setSession: vi.fn(),
}

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ auth }) }))
vi.mock('./api/account', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountApi>()),
  fetchAccount: vi.fn(),
}))

const sessionFor = (userId: string) => ({ user: { id: userId } }) as Session
const PRIVATE_KEY = ['meals', 'user-a', '2026-10-11']

function Probe() {
  const { state, signOut } = useAuth()
  return (
    <div>
      <p data-testid="status">
        {state.status}
        {state.status === 'signed_out' && state.reason ? `:${state.reason}` : ''}
      </p>
      <button onClick={() => void signOut()}>Log out</button>
    </div>
  )
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

const status = () => screen.getByTestId('status').textContent

async function signedInWithPrivateData() {
  auth.session = sessionFor('user-a')
  const queryClient = renderProvider()
  await waitFor(() => {
    expect(status()).toBe('signed_in')
  })
  queryClient.setQueryData(PRIVATE_KEY, [{ food: 'Chicken', calories: 165 }])
  return queryClient
}

beforeEach(() => {
  auth.session = null
  auth.listener = null
  vi.mocked(fetchAccount).mockResolvedValue(makeAccount())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuthProvider session edge cases', () => {
  it('logout clears every cached query', async () => {
    const queryClient = await signedInWithPrivateData()
    await act(async () => {
      screen.getByRole('button', { name: 'Log out' }).click()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(status()).toBe('signed_out:logout')
    })
    expect(queryClient.getQueryData(PRIVATE_KEY)).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('an expired session (refresh token rejected) signs out and clears the cache', async () => {
    const queryClient = await signedInWithPrivateData()
    // supabase-js emits SIGNED_OUT on its own when the refresh token is no longer valid.
    act(() => {
      auth.listener?.('SIGNED_OUT', null)
    })
    await waitFor(() => {
      expect(status()).toBe('signed_out:expired')
    })
    expect(queryClient.getQueryData(PRIVATE_KEY)).toBeUndefined()
  })

  it('a refreshed token for the same user keeps the session and its data', async () => {
    const queryClient = await signedInWithPrivateData()
    act(() => {
      auth.listener?.('TOKEN_REFRESHED', sessionFor('user-a'))
    })
    expect(status()).toBe('signed_in')
    expect(queryClient.getQueryData(PRIVATE_KEY)).toBeDefined()
  })

  it('a deactivated account is signed out with the reason, and the cache is cleared', async () => {
    const queryClient = await signedInWithPrivateData()
    vi.mocked(fetchAccount).mockRejectedValue(new AccountUnavailableError())
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['account', 'user-a'] })
    })
    await waitFor(() => {
      expect(status()).toBe('signed_out:disabled')
    })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(queryClient.getQueryData(PRIVATE_KEY)).toBeUndefined()
  })

  it('a different user signing in never sees the previous user’s cached data', async () => {
    const queryClient = await signedInWithPrivateData()
    act(() => {
      auth.listener?.('SIGNED_IN', sessionFor('user-b'))
    })
    expect(queryClient.getQueryData(PRIVATE_KEY)).toBeUndefined()
    await waitFor(() => {
      expect(fetchAccount).toHaveBeenLastCalledWith(expect.anything(), 'user-b')
    })
  })

  it('a role change is picked up when the account is re-read', async () => {
    const queryClient = await signedInWithPrivateData()
    vi.mocked(fetchAccount).mockResolvedValue(makeAccount({ roles: ['USER', 'ADMIN'] }))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['account', 'user-a'] })
    })
    await waitFor(() => {
      expect(queryClient.getQueryData<{ roles: string[] }>(['account', 'user-a'])?.roles).toEqual([
        'USER',
        'ADMIN',
      ])
    })
    expect(status()).toBe('signed_in')
  })

  it('a network failure while reading the account is an error state, not a sign-out', async () => {
    auth.session = sessionFor('user-a')
    vi.mocked(fetchAccount).mockRejectedValue(new TypeError('Failed to fetch'))
    renderProvider()
    // The account read retries twice (with backoff) before it reports failure.
    await waitFor(
      () => {
        expect(status()).toBe('error')
      },
      { timeout: 10_000 },
    )
    expect(auth.signOut).not.toHaveBeenCalled()
  }, 15_000)
})
