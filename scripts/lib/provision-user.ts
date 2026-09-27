/**
 * Trusted, server-side account provisioning (service role). Used by the
 * `user:create` CLI and integration tests. The Admin "create user" / "reset
 * PIN" Edge Functions will follow the same steps.
 *
 * NEVER import from browser code.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  authEmailForUser,
  deriveAuthPassword,
  E164_PHONE,
  PIN_FORMAT,
} from '../../supabase/functions/_shared/pin-auth.ts'
import type { Database } from '../../src/types/database.ts'

export type AppRole = Database['public']['Enums']['app_role']
export type AdminClient = SupabaseClient<Database>

export interface ProvisionUserInput {
  phone: string
  pin: string
  name?: string
  /** Extra global roles; every profile receives USER automatically. */
  roles?: AppRole[]
  /** Admin performing the action (recorded in the audit log). */
  actorId?: string
}

function assertCredentials(phone: string, pin: string): void {
  if (!E164_PHONE.test(phone)) throw new Error('Phone must be in E.164 format, e.g. +919876543210')
  if (!PIN_FORMAT.test(pin)) throw new Error('PIN must be exactly 4 digits')
}

/**
 * Creates the Supabase Auth user, the profile (onboarding still pending), any
 * extra roles and the PIN. If the profile cannot be created the auth user is
 * removed again, so no half-created login remains.
 */
export async function provisionUser(
  admin: AdminClient,
  pinAuthSecret: string,
  input: ProvisionUserInput,
): Promise<string> {
  assertCredentials(input.phone, input.pin)

  const userId = crypto.randomUUID()
  const { error: authError } = await admin.auth.admin.createUser({
    id: userId,
    email: authEmailForUser(userId),
    email_confirm: true,
    password: await deriveAuthPassword(pinAuthSecret, userId),
    app_metadata: { auth_method: 'phone_pin' },
  })
  if (authError) throw new Error(`Could not create auth user: ${authError.message}`)

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: userId, phone: input.phone, name: input.name ?? null })
  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    throw new Error(
      profileError.code === '23505'
        ? 'A user with this phone number already exists'
        : `Could not create profile: ${profileError.message}`,
    )
  }

  const extraRoles = (input.roles ?? []).filter((role) => role !== 'USER')
  if (extraRoles.length > 0) {
    const { error: rolesError } = await admin
      .from('user_roles')
      .insert(
        extraRoles.map((role) => ({ user_id: userId, role, created_by: input.actorId ?? null })),
      )
    if (rolesError) throw new Error(`Profile created but roles failed: ${rolesError.message}`)
  }

  await setUserPin(admin, userId, input.pin, input.actorId)
  return userId
}

export async function setUserPin(
  admin: AdminClient,
  userId: string,
  pin: string,
  actorId?: string,
): Promise<void> {
  if (!PIN_FORMAT.test(pin)) throw new Error('PIN must be exactly 4 digits')
  const { error } = await admin.rpc('auth_set_pin', {
    p_user_id: userId,
    p_pin: pin,
    ...(actorId ? { p_actor_id: actorId } : {}),
  })
  if (error) throw new Error(`Could not set PIN: ${error.message}`)
}

export async function findUserIdByPhone(admin: AdminClient, phone: string): Promise<string | null> {
  const { data, error } = await admin.from('profiles').select('id').eq('phone', phone).maybeSingle()
  if (error) throw new Error(`Lookup failed: ${error.message}`)
  return data?.id ?? null
}
