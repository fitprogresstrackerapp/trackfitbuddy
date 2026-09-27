import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp, signedOut } from '@/test/auth-harness'

import { LoginError } from '../api/pin-login'

afterEach(cleanup)

const SECRET_PIN = '4829'

async function fillAndSubmit(phone: string, pin: string) {
  fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: phone } })
  fireEvent.change(screen.getByLabelText('PIN'), { target: { value: pin } })
  fireEvent.click(screen.getByRole('button', { name: 'Login' }))
}

describe('LoginPage', () => {
  it('validates empty fields without calling the server', async () => {
    const { signIn } = renderApp({ path: '/login', state: signedOut() })
    fireEvent.click(await screen.findByRole('button', { name: 'Login' }))
    expect(await screen.findByText('Enter your phone number')).toBeTruthy()
    expect(screen.getByText('Enter your PIN')).toBeTruthy()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('rejects a malformed phone and a short PIN', async () => {
    const { signIn } = renderApp({ path: '/login', state: signedOut() })
    await fillAndSubmit('12345', '123')
    expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeTruthy()
    expect(screen.getByText('PIN must be exactly 4 digits')).toBeTruthy()
    expect(screen.getByLabelText('Phone number').getAttribute('aria-invalid')).toBe('true')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('accepts digits only in the PIN field', async () => {
    renderApp({ path: '/login', state: signedOut() })
    const pin = await screen.findByLabelText<HTMLInputElement>('PIN')
    fireEvent.change(pin, { target: { value: '12a4567' } })
    expect(pin.value).toBe('1245')
    expect(pin.getAttribute('type')).toBe('password')
    expect(pin.getAttribute('inputmode')).toBe('numeric')
  })

  it('submits the normalized phone number', async () => {
    const { signIn } = renderApp({ path: '/login', state: signedOut() })
    await fillAndSubmit('+91 98765-43210', SECRET_PIN)
    expect(await screen.findByRole('heading', { level: 1, name: /home/i })).toBeTruthy()
    expect(signIn).toHaveBeenCalledWith({ phone: '+919876543210', pin: SECRET_PIN })
  })

  it('shows a generic message for wrong credentials, clears the PIN and never logs it', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method),
    )
    renderApp({
      path: '/login',
      state: signedOut(),
      signInError: new LoginError('INVALID_CREDENTIALS'),
    })
    await fillAndSubmit('9876543210', SECRET_PIN)

    expect(await screen.findByText('Phone number or PIN is incorrect.')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('PIN').value).toBe('')
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET_PIN)
      }
    }
    expect(window.location.href).not.toContain(SECRET_PIN)
    const stored = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index)
      return key ? `${key}=${window.localStorage.getItem(key) ?? ''}` : ''
    })
    expect(stored.join('\n')).not.toContain(SECRET_PIN)
  })

  it.each([
    ['ACCOUNT_DISABLED' as const, 'This account is not active. Contact your admin.'],
    ['TOO_MANY_ATTEMPTS' as const, 'Too many attempts. Try again in 15 minutes.'],
    ['NETWORK' as const, 'Can’t reach the server. Check your connection and try again.'],
    ['SERVER_ERROR' as const, 'Login is unavailable right now. Try again shortly.'],
  ])('maps %s to a concise message', async (code, message) => {
    renderApp({ path: '/login', state: signedOut(), signInError: new LoginError(code) })
    await fillAndSubmit('9876543210', '1234')
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it('explains why a deactivated user was signed out', async () => {
    renderApp({ path: '/login', state: signedOut('disabled') })
    expect(await screen.findByText('This account is not active. Contact your admin.')).toBeTruthy()
  })

  it('explains an expired session', async () => {
    renderApp({ path: '/login', state: signedOut('expired') })
    expect(await screen.findByText('Your session ended. Log in again to continue.')).toBeTruthy()
  })
})
