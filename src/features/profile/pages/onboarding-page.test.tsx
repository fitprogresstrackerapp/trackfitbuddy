import '@/test/mock-home-data'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccount, renderApp, signedIn } from '@/test/auth-harness'

import { saveBasics } from '../api/onboarding'

vi.mock('../api/onboarding', () => ({
  saveBasics: vi.fn(),
  saveMeasurements: vi.fn(),
}))

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
})

afterEach(cleanup)

async function fillBasics() {
  renderApp({ path: '/onboarding', state: signedIn(makeAccount({ complete: false })) })
  await screen.findByRole('heading', { level: 1, name: 'Basic information' })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Asha' } })
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1994-05-17' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Female' }))
}

describe('Onboarding save failures', () => {
  it('a database error is shown as plain text and the form can be retried', async () => {
    vi.mocked(saveBasics).mockRejectedValueOnce({
      code: '23514',
      message: 'new row for relation "profiles" violates check constraint "profiles_name_check"',
      details: 'Failing row contains (00000000-0000-0000-0000-0000000000a1, +919876543210, …)',
    })
    await fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/relation|constraint|profiles|Failing row|\+91/)
    expect(alert.textContent).toContain('Check the values')
    // Nothing typed is lost and the form is usable again.
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Asha')
    const submit = screen.getByRole('button', { name: 'Continue' })
    expect((submit as HTMLButtonElement).disabled).toBe(false)

    vi.mocked(saveBasics).mockResolvedValueOnce(undefined)
    fireEvent.click(submit)
    await waitFor(() => {
      expect(saveBasics).toHaveBeenCalledTimes(2)
    })
  })

  it('a network failure says so, without technical detail', async () => {
    vi.mocked(saveBasics).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t reach the server')
    expect(alert.textContent).not.toContain('Failed to fetch')
  })

  it('a second click while saving does not send a second request', async () => {
    let finish: () => void = () => undefined
    vi.mocked(saveBasics).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    await fillBasics()
    const submit = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(submit)
    await screen.findByRole('button', { name: 'Saving…' })
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
    const form = screen.getByLabelText('Name').closest('form')
    if (!form) throw new Error('form missing')
    fireEvent.submit(form)
    expect(saveBasics).toHaveBeenCalledTimes(1)
    finish()
  })
})
