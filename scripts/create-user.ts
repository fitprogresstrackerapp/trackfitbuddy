/**
 * Create an account (or reset a PIN) with the service role — the Phase 1
 * bootstrap path until the Admin UI exists. Runs on a trusted machine only.
 *
 *   npm run user:create -- --local --phone 9876543210 --pin 1234 [--name Asha] [--role SUPER_ADMIN]
 *   npm run user:create -- --local --phone 9876543210 --pin 4321 --reset-pin
 *
 * Without --local, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PIN_AUTH_SECRET
 * are read from the environment. The PIN is never printed.
 */
import { parseArgs } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import { normalizeIndianPhone } from '../src/features/auth/lib/phone.ts'
import type { Database } from '../src/types/database.ts'
import { readLocalServerEnv, readProcessServerEnv } from './lib/local-env.ts'
import { findUserIdByPhone, provisionUser, setUserPin, type AppRole } from './lib/provision-user.ts'

const ROLES: readonly AppRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER']

function isRole(value: string): value is AppRole {
  return (ROLES as readonly string[]).includes(value)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean', default: false },
      phone: { type: 'string' },
      pin: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', multiple: true, default: [] },
      'reset-pin': { type: 'boolean', default: false },
    },
  })

  const phone = normalizeIndianPhone(values.phone ?? '')
  if (!phone) throw new Error('--phone must be a valid Indian mobile number')
  const pin = values.pin ?? ''

  const roles = values.role.map((role) => role.toUpperCase())
  const invalidRole = roles.find((role) => !isRole(role))
  if (invalidRole) throw new Error(`Unknown role: ${invalidRole}. Use one of ${ROLES.join(', ')}`)

  const env = values.local ? readLocalServerEnv() : readProcessServerEnv()
  const admin = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (values['reset-pin']) {
    const userId = await findUserIdByPhone(admin, phone)
    if (!userId) throw new Error('No user with this phone number')
    await setUserPin(admin, userId, pin)
    console.log(`PIN reset for ${phone}`)
    return
  }

  const userId = await provisionUser(admin, env.pinAuthSecret, {
    phone,
    pin,
    ...(values.name ? { name: values.name } : {}),
    roles: roles.filter(isRole),
  })
  console.log(`Created user ${userId} (${phone}). Onboarding completes on first login.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unexpected error')
  process.exitCode = 1
})
