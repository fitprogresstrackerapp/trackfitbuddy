/**
 * POST /functions/v1/pin-login   { phone: "+91XXXXXXXXXX", pin: "1234" }
 *
 * Phone + PIN login bridge (see docs/auth.md):
 *   1. validate input shape;
 *   2. verify the PIN with public.auth_verify_pin() (bcrypt + lockout);
 *   3. sign in to Supabase Auth with the server-derived credential;
 *   4. return only the session tokens.
 *
 * The request body is never logged. Errors are generic codes; an unknown phone
 * and a wrong PIN are indistinguishable.
 */
import { createClient } from '@supabase/supabase-js'

import {
  authEmailForUser,
  deriveAuthPassword,
  E164_PHONE,
  PIN_FORMAT,
} from '../_shared/pin-auth.ts'

type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'ACCOUNT_DISABLED'
  | 'METHOD_NOT_ALLOWED'
  | 'SERVER_ERROR'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const PIN_AUTH_SECRET = Deno.env.get('PIN_AUTH_SECRET') ?? ''
const ALLOWED_ORIGINS = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
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

function fail(code: ErrorCode, status: number, origin: string | null): Response {
  return json({ error: code }, status, origin)
}

function readCredentials(body: unknown): { phone: string; pin: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const { phone, pin } = body as Record<string, unknown>
  if (typeof phone !== 'string' || typeof pin !== 'string') return null
  if (!E164_PHONE.test(phone) || !PIN_FORMAT.test(pin)) return null
  return { phone, pin }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 405, origin)
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || PIN_AUTH_SECRET.length < 32) {
    console.error('pin-login: missing server configuration')
    return fail('SERVER_ERROR', 500, origin)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 400, origin)
  }

  const credentials = readCredentials(body)
  if (!credentials) {
    return fail('INVALID_INPUT', 400, origin)
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: verification, error: verifyError } = await serviceClient
    .rpc('auth_verify_pin', { p_phone: credentials.phone, p_pin: credentials.pin })
    .single<{ status: string; user_id: string | null }>()

  if (verifyError) {
    console.error('pin-login: verification failed', verifyError.code)
    return fail('SERVER_ERROR', 500, origin)
  }

  switch (verification.status) {
    case 'OK':
      break
    case 'LOCKED':
      return fail('TOO_MANY_ATTEMPTS', 429, origin)
    case 'DISABLED':
      return fail('ACCOUNT_DISABLED', 403, origin)
    default:
      return fail('INVALID_CREDENTIALS', 401, origin)
  }

  if (!verification.user_id) {
    return fail('SERVER_ERROR', 500, origin)
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
    email: authEmailForUser(verification.user_id),
    password: await deriveAuthPassword(PIN_AUTH_SECRET, verification.user_id),
  })

  if (signInError || !signIn.session) {
    console.error('pin-login: session could not be established', signInError?.code ?? 'no_session')
    return fail('SERVER_ERROR', 500, origin)
  }

  const { session } = signIn
  return json(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: session.token_type,
    },
    200,
    origin,
  )
})
