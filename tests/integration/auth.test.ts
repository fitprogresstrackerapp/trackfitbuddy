/**
 * Phone + PIN authentication against the local stack (Edge Function, Supabase
 * Auth, PostgREST, RLS). Requires `npm run supabase:start` (which also serves
 * the Edge Functions).
 */
import { describe, expect, it } from 'vitest'

import { authEmailForUser } from '../../supabase/functions/_shared/pin-auth.ts'
import {
  adminClient,
  browserClient,
  createUser,
  pinLogin,
  signedInClient,
  uniquePhone,
} from './helpers.ts'

describe('pin-login', () => {
  it('returns a working Supabase session for valid credentials', async () => {
    const user = await createUser('0000')
    const { status, payload } = await pinLogin({ phone: user.phone, pin: user.pin })

    expect(status).toBe(200)
    expect(Object.keys(payload).sort()).toEqual(
      ['access_token', 'expires_at', 'expires_in', 'refresh_token', 'token_type'].sort(),
    )

    const client = await signedInClient(user.phone, user.pin)
    const { data: auth } = await client.auth.getUser()
    expect(auth.user?.id).toBe(user.userId)

    const { data: profile } = await client
      .from('profiles')
      .select('id, phone')
      .eq('id', user.userId)
      .single()
    expect(profile).toEqual({ id: user.userId, phone: user.phone })
  })

  it('gives the same generic answer for a wrong PIN and an unknown phone', async () => {
    const user = await createUser('1234')
    const wrongPin = await pinLogin({ phone: user.phone, pin: '9999' })
    const unknownPhone = await pinLogin({ phone: uniquePhone(), pin: '1234' })

    expect(wrongPin).toEqual({ status: 401, payload: { error: 'INVALID_CREDENTIALS' } })
    expect(unknownPhone).toEqual(wrongPin)
  })

  it.each([
    [{ phone: '9876543210', pin: '1234' }], // not canonical E.164
    [{ phone: '+919876543210', pin: '123' }],
    [{ phone: '+919876543210', pin: '12345' }],
    [{ phone: '+919876543210', pin: '12a4' }],
    [{ phone: '+919876543210', pin: 'password' }],
    [{ phone: '+919876543210', pin: '' }],
    [{ phone: '', pin: '1234' }],
    [{ phone: '+919876543210', pin: 1234 }],
    [{}],
  ])('rejects malformed input %j', async (body) => {
    expect(await pinLogin(body)).toEqual({ status: 400, payload: { error: 'INVALID_INPUT' } })
  })

  it('refuses a deactivated account only after a correct PIN', async () => {
    const user = await createUser('2468')
    await adminClient().from('profiles').update({ is_active: false }).eq('id', user.userId)

    expect(await pinLogin({ phone: user.phone, pin: '2468' })).toEqual({
      status: 403,
      payload: { error: 'ACCOUNT_DISABLED' },
    })
    expect(await pinLogin({ phone: user.phone, pin: '1111' })).toEqual({
      status: 401,
      payload: { error: 'INVALID_CREDENTIALS' },
    })
  })

  it('locks a phone after 5 failed attempts, and a PIN reset unlocks it', async () => {
    const user = await createUser('1357')
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await pinLogin({ phone: user.phone, pin: '0000' })).status).toBe(401)
    }
    expect(await pinLogin({ phone: user.phone, pin: '1357' })).toEqual({
      status: 429,
      payload: { error: 'TOO_MANY_ATTEMPTS' },
    })

    const { error } = await adminClient().rpc('auth_set_pin', {
      p_user_id: user.userId,
      p_pin: '8642',
    })
    expect(error).toBeNull()
    expect((await pinLogin({ phone: user.phone, pin: '8642' })).status).toBe(200)
  })

  it('locks unknown phones the same way (no account enumeration)', async () => {
    const phone = uniquePhone()
    for (let attempt = 0; attempt < 5; attempt++) await pinLogin({ phone, pin: '0000' })
    expect((await pinLogin({ phone, pin: '0000' })).payload).toEqual({ error: 'TOO_MANY_ATTEMPTS' })
  })
})

describe('Supabase Auth hardening', () => {
  it('the PIN is not a usable Supabase Auth password', async () => {
    const user = await createUser('1234')
    const { data, error } = await browserClient().auth.signInWithPassword({
      email: authEmailForUser(user.userId),
      password: '1234',
    })
    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  it('self-registration is disabled', async () => {
    const { data, error } = await browserClient().auth.signUp({
      email: `someone-${Date.now()}@example.com`,
      password: 'long-enough-password-123',
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})

describe('session lifecycle', () => {
  it('logout revokes the refresh token', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)
    const { data } = await client.auth.getSession()
    const refreshToken = data.session?.refresh_token ?? ''

    const { error: signOutError } = await client.auth.signOut({ scope: 'local' })
    expect(signOutError).toBeNull()
    expect((await client.auth.getSession()).data.session).toBeNull()

    const { error: refreshError } = await browserClient().auth.refreshSession({
      refresh_token: refreshToken,
    })
    expect(refreshError).not.toBeNull()
  })

  it('a deactivated user loses data access during an active session', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)
    expect((await client.from('profiles').select('id')).data).toHaveLength(1)

    await adminClient().from('profiles').update({ is_active: false }).eq('id', user.userId)

    const { data: profile } = await client
      .from('profiles')
      .select('id')
      .eq('id', user.userId)
      .maybeSingle()
    expect(profile).toBeNull() // the app treats this as "account unavailable" and signs out
    expect((await client.from('weight_measurements').select('id')).data).toEqual([])
  })
})
