/**
 * Onboarding persistence and data-isolation checks against the local stack.
 */
import { describe, expect, it } from 'vitest'

import { adminClient, browserClient, createUser, signedInClient } from './helpers.ts'

async function saveBasics(client: Awaited<ReturnType<typeof signedInClient>>, userId: string) {
  const { error } = await client
    .from('profiles')
    .update({ name: 'Asha', date_of_birth: '1994-05-17', gender: 'PREFER_NOT_TO_SAY' })
    .eq('id', userId)
  expect(error).toBeNull()
}

describe('onboarding', () => {
  it('a new admin-created account starts incomplete', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)
    const { data } = await client
      .from('profile_readiness')
      .select('is_profile_complete, missing_fields')
      .single()
    expect(data).toEqual({
      is_profile_complete: false,
      missing_fields: ['name', 'date_of_birth', 'gender', 'height_cm', 'current_weight'],
    })
  })

  it('stores height and exactly one initial weight, even when submitted twice', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)
    await saveBasics(client, user.userId)

    const [first, second] = await Promise.all([
      client.rpc('save_onboarding_measurements', { p_height_cm: 172.5, p_weight_kg: 70.4 }),
      client.rpc('save_onboarding_measurements', { p_height_cm: 172.5, p_weight_kg: 70.4 }),
    ])
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    // A later retry with a corrected value updates the same measurement.
    expect(
      (await client.rpc('save_onboarding_measurements', { p_height_cm: 172.5, p_weight_kg: 70.2 }))
        .error,
    ).toBeNull()

    const { data: weights } = await client
      .from('weight_measurements')
      .select('weight_kg, source, is_deleted')
    expect(weights).toEqual([{ weight_kg: 70.2, source: 'MANUAL', is_deleted: false }])

    const { data: profile } = await client.from('profiles').select('height_cm').single()
    expect(profile?.height_cm).toBe(172.5)

    const { data: readiness } = await client
      .from('profile_readiness')
      .select('is_profile_complete')
      .single()
    expect(readiness?.is_profile_complete).toBe(true)
  })

  it('rejects impossible values server-side and saves nothing', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)

    const badHeight = await client.rpc('save_onboarding_measurements', {
      p_height_cm: 20,
      p_weight_kg: 70,
    })
    expect(badHeight.error?.code).toBe('23514')
    const badWeight = await client.rpc('save_onboarding_measurements', {
      p_height_cm: 170,
      p_weight_kg: 5,
    })
    expect(badWeight.error?.code).toBe('23514')
    expect((await client.from('weight_measurements').select('id')).data).toEqual([])
    expect((await client.from('profiles').select('height_cm').single()).data?.height_cm).toBeNull()

    const futureDob = await client
      .from('profiles')
      .update({ date_of_birth: '2999-01-01' })
      .eq('id', user.userId)
    expect(futureDob.error).not.toBeNull()
    const badGender = await client
      .from('profiles')
      .update({ gender: 'UNKNOWN' as never })
      .eq('id', user.userId)
    expect(badGender.error).not.toBeNull()
  })

  it('requires authentication', async () => {
    const { error } = await browserClient().rpc('save_onboarding_measurements', {
      p_height_cm: 170,
      p_weight_kg: 70,
    })
    expect(error).not.toBeNull()
  })
})

describe('security', () => {
  it('PIN hashes and login attempts are unreachable from the API', async () => {
    const user = await createUser('1234')
    const client = await signedInClient(user.phone, user.pin)

    for (const table of ['user_pins', 'login_attempts']) {
      const { data, error } = await client.from(table as 'profiles').select('*')
      expect(data).toBeNull()
      expect(error).not.toBeNull()
    }
  })

  it('PIN functions cannot be called by browsers', async () => {
    const user = await createUser('1234')
    const signedIn = await signedInClient(user.phone, user.pin)

    for (const client of [browserClient(), signedIn]) {
      const verify = await client.rpc('auth_verify_pin', { p_phone: user.phone, p_pin: '1234' })
      expect(verify.error).not.toBeNull()
      expect(verify.data).toBeNull()
      const reset = await client.rpc('auth_set_pin', { p_user_id: user.userId, p_pin: '0000' })
      expect(reset.error).not.toBeNull()
    }
  })

  it('no API response contains the PIN or its hash', async () => {
    const pin = '7391'
    const user = await createUser(pin)
    const client = await signedInClient(user.phone, pin)

    const responses = await Promise.all([
      client.from('profiles').select('*'),
      client.from('user_roles').select('*'),
      client.from('profile_readiness').select('*'),
      client.auth.getUser(),
      adminClient().from('audit_logs').select('*').eq('target_user_id', user.userId),
      adminClient().auth.admin.getUserById(user.userId),
    ])
    const serialized = JSON.stringify(responses.map((response) => response.data))
    expect(serialized).not.toContain(pin)
    expect(serialized).not.toMatch(/\$2[aby]\$/) // bcrypt hash marker
  })

  it('another user cannot read or change this user’s private profile', async () => {
    const victim = await createUser('1234')
    const attacker = await createUser('4321')
    const victimClient = await signedInClient(victim.phone, victim.pin)
    await saveBasics(victimClient, victim.userId)
    const attackerClient = await signedInClient(attacker.phone, attacker.pin)

    const read = await attackerClient.from('profiles').select('*').eq('id', victim.userId)
    expect(read.data).toEqual([])

    const readiness = await attackerClient
      .from('profile_readiness')
      .select('*')
      .eq('user_id', victim.userId)
    expect(readiness.data).toEqual([])

    const update = await attackerClient
      .from('profiles')
      .update({ name: 'Hacked' })
      .eq('id', victim.userId)
      .select('id')
    expect(update.data).toEqual([])

    const insert = await attackerClient
      .from('weight_measurements')
      .insert({ user_id: victim.userId, measurement_date: '2026-01-01', weight_kg: 99 })
    expect(insert.error).not.toBeNull()

    const { data: victimProfile } = await victimClient.from('profiles').select('name').single()
    expect(victimProfile?.name).toBe('Asha')
  })
})
