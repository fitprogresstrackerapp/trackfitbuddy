/**
 * Admin management, corrections & audit against the real local stack: the
 * admin-users Edge Function (create user, reset PIN), the admin SQL functions
 * and RLS, through the app's own data functions as signed-in users.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  applyCorrection,
  fetchAudit,
  fetchDayRecords,
  fetchUserAccount,
  listUsers,
  setUserActive,
} from '@/features/admin/api/admin-data'
import { saveBasics, saveMeasurements } from '@/features/profile/api/onboarding'
import { fetchNutritionPeriod } from '@/features/progress/api/progress-data'
import { addDays } from '@/lib/dates/local-date'

import { seedFoods, seedPastMeal } from './food-fixtures.ts'
import {
  adminClient,
  createUser,
  env,
  pinLogin,
  signedInClient,
  type BrowserClient,
} from './helpers.ts'
import { must, run, TODAY } from './home-fixtures.ts'
import { seedLockedWorkout } from './training-fixtures.ts'

const NO_FILTERS = { search: '', role: null, active: null, complete: null }
const AUDIT = { from: '', to: '', action: null, entity: null, actor: '', target: '' }

function uniqueIndianMobile(): string {
  return `+917${`${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)}`
}

async function callAdminUsers(client: BrowserClient | null, body: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env().anonKey,
  }
  if (client) {
    const token = (await client.auth.getSession()).data.session?.access_token
    if (!token) throw new Error('No session')
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${env().supabaseUrl}/functions/v1/admin-users`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    // gateway error without JSON
  }
  return { status: response.status, body: payload }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('Admin management', () => {
  const service = adminClient()
  let admin: BrowserClient
  let superAdmin: BrowserClient
  let manager: BrowserClient
  let managerId: string
  let superAdminId: string
  let otherAdminId: string
  const phone = uniqueIndianMobile()
  let userId: string
  let userClient: BrowserClient

  beforeAll(async () => {
    const a = await createUser('1111', ['ADMIN'])
    const s = await createUser('2222', ['SUPER_ADMIN'])
    const m = await createUser('3333', ['MANAGER'])
    const other = await createUser('4444', ['ADMIN'])
    await run(service.from('profiles').update({ name: 'Ada Admin' }).eq('id', a.userId))
    managerId = m.userId
    superAdminId = s.userId
    otherAdminId = other.userId
    admin = await signedInClient(a.phone, a.pin)
    superAdmin = await signedInClient(s.phone, s.pin)
    manager = await signedInClient(m.phone, m.pin)
  })

  describe('account lifecycle', () => {
    it('1. an admin creates a user (phone, initial PIN, role) through the secure function', async () => {
      const response = await callAdminUsers(admin, {
        action: 'create_user',
        phone,
        pin: '5678',
        role: 'USER',
      })
      expect(response.status).toBe(201)
      userId = response.body.user_id as string
      expect(userId).toMatch(/^[0-9a-f-]{36}$/)
      expect(JSON.stringify(response.body)).not.toMatch(/5678|hash/)
      const again = await callAdminUsers(admin, {
        action: 'create_user',
        phone,
        pin: '1234',
        role: 'USER',
      })
      expect(again).toMatchObject({ status: 409, body: { error: 'PHONE_TAKEN' } })
    })

    it('2. the user signs in with the initial PIN and completes onboarding', async () => {
      userClient = await signedInClient(phone, '5678')
      await saveBasics(userClient, userId, {
        name: 'Neha New',
        dateOfBirth: '1995-04-02',
        gender: 'FEMALE',
      })
      await saveMeasurements(userClient, { heightCm: 160, weightKg: 58 })
    })

    it('3. the admin finds and views the user (server-side search)', async () => {
      const found = await listUsers(admin, { ...NO_FILTERS, search: phone.slice(-10) }, 0)
      expect(found.rows).toHaveLength(1)
      expect(found.rows[0]).toMatchObject({
        userId,
        name: 'Neha New',
        isActive: true,
        isProfileComplete: true,
        recommendationStatus: 'NONE',
      })
      expect(Object.keys(found.rows[0] ?? {})).not.toContain('pin')
      const account = await fetchUserAccount(admin, userId)
      expect(account).toMatchObject({
        name: 'Neha New',
        heightCm: 160,
        missingFields: [],
        canAdminister: true,
      })
    })

    it('4–5. PIN reset: the old PIN stops working, the new one works, nothing secret leaks', async () => {
      const response = await callAdminUsers(admin, {
        action: 'reset_pin',
        user_id: userId,
        pin: '8765',
        reason: 'Forgot PIN',
      })
      expect(response).toMatchObject({ status: 200, body: { ok: true } })
      expect((await pinLogin({ phone, pin: '5678' })).status).toBe(401)
      userClient = await signedInClient(phone, '8765')
      const audit = await fetchAudit(admin, { ...AUDIT, action: 'PIN_RESET', target: 'Neha' }, 0)
      expect(audit.rows[0]).toMatchObject({
        action: 'PIN_RESET',
        actorName: 'Ada Admin',
        reason: 'Forgot PIN',
      })
      expect(JSON.stringify(audit.rows)).not.toMatch(/8765|5678|\$2[aby]\$/)
    })

    it('6–7. deactivation: login refused, the open session loses access, data kept', async () => {
      await setUserActive(admin, userId, false, 'Paused membership')
      expect(await pinLogin({ phone, pin: '8765' })).toMatchObject({
        status: 403,
        payload: { error: 'ACCOUNT_DISABLED' },
      })
      const { data } = await userClient.from('weight_measurements').select('id')
      expect(data ?? []).toEqual([])
      const kept = await must(
        service.from('weight_measurements').select('id').eq('user_id', userId),
      )
      expect(kept).toHaveLength(1)
      expect((await fetchUserAccount(admin, userId))?.isActive).toBe(false)
      // A deactivated user cannot reactivate themselves.
      const self = await userClient
        .from('profiles')
        .update({ is_active: true })
        .eq('id', userId)
        .select('id')
      expect(self.data ?? []).toEqual([])
    })

    it('8–9. reactivation restores access', async () => {
      await setUserActive(admin, userId, true, 'Back')
      userClient = await signedInClient(phone, '8765')
      const { data } = await userClient.from('weight_measurements').select('id')
      expect(data).toHaveLength(1)
    })
  })

  describe('corrections', () => {
    const yesterday = addDays(TODAY, -1)

    beforeAll(async () => {
      const foods = await seedFoods(service)
      await seedPastMeal(service, userId, yesterday, foods.chicken.id, 100)
      await seedLockedWorkout(service, userId, yesterday, 'LEGS', 40)
    })

    it('10–14. an admin corrects locked data; original kept, analytics follow, audit recorded', async () => {
      const before = await fetchDayRecords(admin, userId, yesterday)
      const item = before.meals[0]?.items[0]
      if (!item) throw new Error('fixture missing')
      const [progressBefore] = (
        await fetchNutritionPeriod(userClient, userId, { start: yesterday, end: yesterday })
      ).days

      await applyCorrection(
        admin,
        {
          domain: 'meal_item',
          id: item.id,
          version: item.updatedAt,
          quantity: item.quantity * 2,
          foodItemId: null,
        },
        'Portion was doubled',
      )
      const [progressAfter] = (
        await fetchNutritionPeriod(userClient, userId, { start: yesterday, end: yesterday })
      ).days
      expect(progressAfter?.calories).toBeCloseTo((progressBefore?.calories ?? 0) * 2, 1)

      const audit = await fetchAudit(
        admin,
        { ...AUDIT, action: 'ADMIN_CORRECTION', entity: 'meal_items', target: 'Neha' },
        0,
      )
      const entry = audit.rows[0]
      expect(entry).toMatchObject({
        actorName: 'Ada Admin',
        reason: 'Portion was doubled',
        entityId: item.id,
      })
      expect(entry?.oldValues).toMatchObject({ quantity: item.quantity })
      expect(entry?.newValues).toMatchObject({ quantity: item.quantity * 2 })

      // The user's lock is unchanged.
      const edit = await userClient.from('meal_items').update({ quantity: 1 }).eq('id', item.id)
      expect(edit.error?.code).toBe('42501')
    })

    it('a stale correction is rejected instead of overwriting a newer one', async () => {
      const records = await fetchDayRecords(admin, userId, yesterday)
      const workout = records.workouts[0]
      if (!workout) throw new Error('fixture missing')
      const correction = {
        domain: 'training' as const,
        kind: 'workout' as const,
        id: workout.id,
        version: workout.updatedAt,
        type: 'LEGS',
        name: null,
        durationMinutes: 50,
        manualCalories: null,
      }
      await applyCorrection(admin, correction, null)
      await expectCode(
        applyCorrection(superAdmin, { ...correction, durationMinutes: 55 }, null),
        '40001',
      )
      const after = await fetchDayRecords(admin, userId, yesterday)
      expect(after.workouts[0]?.durationMinutes).toBe(50)
      expect(after.workouts[0]?.finalCalories).toBeGreaterThan(workout.finalCalories)
    })
  })

  describe('authorization', () => {
    it('15. a normal user can use no admin reader, action or function', async () => {
      await expectCode(listUsers(userClient, NO_FILTERS, 0), '42501')
      await expectCode(fetchUserAccount(userClient, managerId), '42501')
      await expectCode(fetchAudit(userClient, AUDIT, 0), '42501')
      await expectCode(setUserActive(userClient, managerId, false, null), '42501')
      expect(
        await callAdminUsers(userClient, {
          action: 'create_user',
          phone: uniqueIndianMobile(),
          pin: '1234',
          role: 'USER',
        }),
      ).toMatchObject({ status: 403 })
      expect(
        await callAdminUsers(userClient, { action: 'reset_pin', user_id: managerId, pin: '1234' }),
      ).toMatchObject({
        status: 403,
      })
      expect(
        await callAdminUsers(null, { action: 'reset_pin', user_id: managerId, pin: '1234' }),
      ).toMatchObject({
        status: 401,
      })
    })

    it('a manager sees only assigned users, read-only', async () => {
      expect((await listUsers(manager, NO_FILTERS, 0)).rows).toEqual([])
      await run(
        service.from('manager_user_assignments').insert({ manager_id: managerId, user_id: userId }),
      )
      const assigned = await listUsers(manager, NO_FILTERS, 0)
      expect(assigned.rows.map((row) => row.userId)).toEqual([userId])
      expect((await fetchUserAccount(manager, userId))?.canAdminister).toBe(false)
      expect((await fetchDayRecords(manager, userId, addDays(TODAY, -1))).meals).toHaveLength(1)
      await expectCode(fetchUserAccount(manager, otherAdminId), '42501')
      await expectCode(setUserActive(manager, userId, false, null), '42501')
      await expectCode(fetchAudit(manager, AUDIT, 0), '42501')
      const records = await fetchDayRecords(manager, userId, addDays(TODAY, -1))
      const workout = records.workouts[0]
      if (!workout) throw new Error('fixture missing')
      await expectCode(
        applyCorrection(
          manager,
          {
            domain: 'training',
            kind: 'workout',
            id: workout.id,
            version: workout.updatedAt,
            type: workout.type,
            name: null,
            durationMinutes: 5,
            manualCalories: null,
          },
          null,
        ),
        '42501',
      )
      expect(
        await callAdminUsers(manager, { action: 'reset_pin', user_id: userId, pin: '1234' }),
      ).toMatchObject({
        status: 403,
      })
    })

    it('an admin cannot manage super-admin authority or other admins', async () => {
      expect(
        await callAdminUsers(admin, {
          action: 'create_user',
          phone: uniqueIndianMobile(),
          pin: '1234',
          role: 'ADMIN',
        }),
      ).toMatchObject({ status: 403 })
      expect(
        await callAdminUsers(admin, {
          action: 'create_user',
          phone: uniqueIndianMobile(),
          pin: '1234',
          role: 'SUPER_ADMIN',
        }),
      ).toMatchObject({ status: 400 })
      expect(
        await callAdminUsers(admin, { action: 'reset_pin', user_id: superAdminId, pin: '1234' }),
      ).toMatchObject({
        status: 403,
      })
      await expectCode(setUserActive(admin, otherAdminId, false, null), '42501')
      await expectCode(setUserActive(admin, superAdminId, false, null), '42501')
      // A super admin may create an admin.
      const created = await callAdminUsers(superAdmin, {
        action: 'create_user',
        phone: uniqueIndianMobile(),
        pin: '1234',
        role: 'ADMIN',
      })
      expect(created.status).toBe(201)
    })

    it('input is validated server-side and never carries an actor', async () => {
      for (const body of [
        { action: 'create_user', phone: '+915876543210', pin: '1234', role: 'USER' },
        { action: 'create_user', phone: uniqueIndianMobile(), pin: '12345', role: 'USER' },
        {
          action: 'create_user',
          phone: uniqueIndianMobile(),
          pin: '1234',
          role: 'USER',
          actor_id: superAdminId,
        },
      ]) {
        expect(await callAdminUsers(admin, body)).toMatchObject({
          status: 400,
          body: { error: 'INVALID_INPUT' },
        })
      }
    })
  })
})
