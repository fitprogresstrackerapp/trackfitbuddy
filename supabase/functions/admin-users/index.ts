/**
 * POST /functions/v1/admin-users   (ADMIN / SUPER_ADMIN only)
 *
 *   { "action": "create_user", "phone": "+919876543210", "pin": "1234", "role": "USER" }
 *   { "action": "reset_pin", "user_id": "<uuid>", "pin": "1234", "reason": "optional" }
 *
 * Account creation (spec §5) reuses the existing trusted provisioning code
 * (scripts/lib/provision-user.ts): auth user, profile, roles and the bcrypt
 * PIN via auth_set_pin(). The user then signs in and completes onboarding.
 * PIN reset goes through admin_reset_pin(), which re-checks the authority rule
 * in the database and audits PIN_RESET without any PIN material.
 *
 * The actor is always the verified caller, never a request field. Allowed
 * roles for a new account: ADMIN → USER / MANAGER; SUPER_ADMIN → also ADMIN.
 * Never logged: the request body, PINs, tokens or keys.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { provisionUser } from '../../../scripts/lib/provision-user.ts'
import type { Database } from '../../../src/types/database.ts'

type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'PHONE_TAKEN'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PIN_AUTH_SECRET = Deno.env.get('PIN_AUTH_SECRET') ?? ''
const ALLOWED_ORIGINS = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/** Canonical Indian mobile number (spec §5): +91 and 10 digits starting 6–9. */
const INDIAN_PHONE = /^\+91[6-9][0-9]{9}$/
const PIN = /^[0-9]{4}$/

const requestSchema = z.union([
  z.strictObject({
    action: z.literal('create_user'),
    phone: z.string().regex(INDIAN_PHONE),
    pin: z.string().regex(PIN),
    role: z.enum(['USER', 'MANAGER', 'ADMIN']),
  }),
  z.strictObject({
    action: z.literal('reset_pin'),
    user_id: z.uuid(),
    pin: z.string().regex(PIN),
    reason: z.string().max(500).optional(),
  }),
])

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

const fail = (code: ErrorCode, status: number, origin: string | null) =>
  json({ error: code }, status, origin)

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, origin)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || PIN_AUTH_SECRET.length < 32) {
    console.error('admin-users: missing server configuration')
    return fail('SERVER_ERROR', 500, origin)
  }

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The actor is the verified caller.
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return fail('UNAUTHENTICATED', 401, origin)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return fail('UNAUTHENTICATED', 401, origin)
  const actorId = auth.user.id

  const [roles, actor] = await Promise.all([
    db
      .from('user_roles')
      .select('role')
      .eq('user_id', actorId)
      .in('role', ['ADMIN', 'SUPER_ADMIN']),
    db.from('profiles').select('is_active').eq('id', actorId).maybeSingle(),
  ])
  if (roles.error || actor.error) {
    console.error('admin-users: authorization lookup failed')
    return fail('SERVER_ERROR', 500, origin)
  }
  if (roles.data.length === 0 || !actor.data?.is_active) return fail('FORBIDDEN', 403, origin)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 400, origin)
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return fail('INVALID_INPUT', 400, origin)
  const command = parsed.data

  try {
    if (command.action === 'create_user') {
      const allowed = await db.rpc('admin_can_create_role', {
        p_actor_id: actorId,
        p_role: command.role,
      })
      if (allowed.error) throw new Error('role check')
      if (!allowed.data) return fail('FORBIDDEN', 403, origin)
      const existing = await db
        .from('profiles')
        .select('id')
        .eq('phone', command.phone)
        .maybeSingle()
      if (existing.error) throw new Error('phone lookup')
      if (existing.data) return fail('PHONE_TAKEN', 409, origin)

      const userId = await provisionUser(db, PIN_AUTH_SECRET, {
        phone: command.phone,
        pin: command.pin,
        roles: command.role === 'USER' ? [] : [command.role],
        actorId,
      })
      console.log(JSON.stringify({ fn: 'admin-users', event: 'user_created', role: command.role }))
      return json({ user_id: userId }, 201, origin)
    }

    const { error } = await db.rpc('admin_reset_pin', {
      p_actor_id: actorId,
      p_user_id: command.user_id,
      p_pin: command.pin,
      ...(command.reason ? { p_reason: command.reason } : {}),
    })
    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', 403, origin)
      if (error.code === 'P0002') return fail('NOT_FOUND', 404, origin)
      throw new Error('pin reset')
    }
    console.log(JSON.stringify({ fn: 'admin-users', event: 'pin_reset' }))
    return json({ ok: true }, 200, origin)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/already exists/i.test(message)) return fail('PHONE_TAKEN', 409, origin)
    console.error('admin-users: action failed', command.action)
    return fail('SERVER_ERROR', 500, origin)
  }
})
