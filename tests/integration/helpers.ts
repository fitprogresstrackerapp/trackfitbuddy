import { createClient } from '@supabase/supabase-js'

import { readLocalServerEnv, type ServerEnv } from '../../scripts/lib/local-env.ts'
import { provisionUser, type AdminClient, type AppRole } from '../../scripts/lib/provision-user.ts'
import type { Database } from '../../src/types/database.ts'

export type BrowserClient = ReturnType<typeof createClient<Database>>

let cachedEnv: ServerEnv | undefined

export function env(): ServerEnv {
  cachedEnv ??= readLocalServerEnv()
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(cachedEnv.supabaseUrl)) {
    throw new Error('Integration tests only run against a local Supabase stack')
  }
  return cachedEnv
}

export function adminClient(): AdminClient {
  return createClient<Database>(env().supabaseUrl, env().serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** A client configured exactly like the browser app (anon key, RLS applies). */
export function browserClient(): BrowserClient {
  return createClient<Database>(env().supabaseUrl, env().anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Unique, valid Indian mobile number per call. */
export function uniquePhone(): string {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)
  return `+919${suffix}`
}

export async function createUser(pin: string, roles: AppRole[] = []) {
  const phone = uniquePhone()
  const userId = await provisionUser(adminClient(), env().pinAuthSecret, { phone, pin, roles })
  return { userId, phone, pin }
}

export async function pinLogin(body: unknown) {
  const response = await fetch(`${env().supabaseUrl}/functions/v1/pin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env().anonKey },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as Record<string, unknown>
  return { status: response.status, payload }
}

/** Logs in through the Edge Function and returns a browser-like client holding the session. */
export async function signedInClient(phone: string, pin: string): Promise<BrowserClient> {
  const { status, payload } = await pinLogin({ phone, pin })
  if (
    status !== 200 ||
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string'
  ) {
    throw new Error(`Login failed with ${status}`)
  }
  const client = browserClient()
  const { error } = await client.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  })
  if (error) throw error
  return client
}
