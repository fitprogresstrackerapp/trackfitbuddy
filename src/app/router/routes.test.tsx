import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccount, renderApp, signedIn, signedOut } from '@/test/auth-harness'

beforeEach(() => {
  // The onboarding page creates the Supabase client (no requests are made).
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(cleanup)

const heading = (name: RegExp) => screen.findByRole('heading', { level: 1, name })

describe('unauthenticated', () => {
  it.each(['/', '/food', '/workout', '/progress', '/groups', '/profile', '/onboarding', '/admin'])(
    '%s redirects to Login',
    async (path) => {
      renderApp({ path, state: signedOut() })
      expect(await heading(/log in/i)).toBeTruthy()
    },
  )

  it('shows a loader while the session is resolving', async () => {
    renderApp({ path: '/', state: { status: 'loading' } })
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('returns to the originally requested page after login', async () => {
    renderApp({ path: '/progress', state: signedOut() })
    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '9876543210' },
    })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(await heading(/progress/i)).toBeTruthy()
  })
})

describe('signed in with an incomplete profile', () => {
  const incomplete = signedIn(makeAccount({ complete: false }))

  it.each(['/', '/food', '/profile', '/login'])(
    '%s redirects to onboarding step 1',
    async (path) => {
      renderApp({ path, state: incomplete })
      expect(await heading(/basic information/i)).toBeTruthy()
      expect(screen.getByText('Complete your profile to continue.')).toBeTruthy()
      expect(screen.getByText('01 / 02')).toBeTruthy()
    },
  )

  it('cannot bypass onboarding to reach Admin, even as an admin', async () => {
    renderApp({
      path: '/admin',
      state: signedIn(makeAccount({ complete: false, roles: ['USER', 'ADMIN'] })),
    })
    expect(await heading(/basic information/i)).toBeTruthy()
  })

  it('resumes at step 2 when step 1 was already saved', async () => {
    renderApp({
      path: '/onboarding',
      state: signedIn(makeAccount({ complete: false, basicsSaved: true })),
    })
    expect(await heading(/body measurements/i)).toBeTruthy()
    expect(screen.getByText('02 / 02')).toBeTruthy()
  })
})

describe('signed in with a complete profile', () => {
  it.each(['/', '/login', '/onboarding'])('%s goes to Home', async (path) => {
    renderApp({ path, state: signedIn() })
    expect(await heading(/home/i)).toBeTruthy()
  })

  it('a regular user cannot open Admin', async () => {
    renderApp({ path: '/admin', state: signedIn(makeAccount({ roles: ['USER', 'MANAGER'] })) })
    expect(await heading(/^home$/i)).toBeTruthy()
    expect(screen.queryByText(/admin dashboard/i)).toBeNull()
  })

  it.each([['ADMIN' as const], ['SUPER_ADMIN' as const]])('%s can open Admin', async (role) => {
    renderApp({ path: '/admin', state: signedIn(makeAccount({ roles: ['USER', role] })) })
    expect(await heading(/admin dashboard/i)).toBeTruthy()
  })

  it('logout removes access and shows Login', async () => {
    const { signOut } = renderApp({ path: '/profile', state: signedIn() })
    // Sidebar and Profile page both render a logout button (CSS hides one per breakpoint).
    const [logout] = await screen.findAllByRole('button', { name: /log out/i })
    if (!logout) throw new Error('logout button missing')
    fireEvent.click(logout)
    expect(await heading(/log in/i)).toBeTruthy()
    expect(signOut).toHaveBeenCalledOnce()
    expect(screen.queryByText('Asha')).toBeNull()
  })

  it('after logout, the next login starts at Home (not the page left behind)', async () => {
    renderApp({ path: '/profile', state: signedIn() })
    const [logout] = await screen.findAllByRole('button', { name: /log out/i })
    if (!logout) throw new Error('logout button missing')
    fireEvent.click(logout)
    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '9876543210' },
    })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(await heading(/^home$/i)).toBeTruthy()
  })

  it('offers retry and logout when the account cannot be loaded', async () => {
    renderApp({ path: '/', state: { status: 'error', retry: vi.fn() } })
    expect(await screen.findByText('Couldn’t load your account')).toBeTruthy()
    expect(screen.getByRole('button', { name: /log out/i })).toBeTruthy()
  })
})
