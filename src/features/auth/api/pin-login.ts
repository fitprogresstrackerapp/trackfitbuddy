import { z } from 'zod'

import { getPublicEnv } from '@/lib/env'

import type { LoginCredentials } from '../schemas'

export type LoginErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'ACCOUNT_DISABLED'
  | 'NETWORK'
  | 'SERVER_ERROR'

export class LoginError extends Error {
  readonly code: LoginErrorCode

  constructor(code: LoginErrorCode) {
    super(code)
    this.name = 'LoginError'
    this.code = code
  }
}

/** Deliberately generic: never confirms whether a phone number exists. */
export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  INVALID_INPUT: 'Enter a valid phone number and 4-digit PIN.',
  INVALID_CREDENTIALS: 'Phone number or PIN is incorrect.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Try again in 15 minutes.',
  ACCOUNT_DISABLED: 'This account is not active. Contact your admin.',
  NETWORK: 'Can’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Login is unavailable right now. Try again shortly.',
}

const sessionTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
})

export type SessionTokens = z.output<typeof sessionTokensSchema>

const errorResponseSchema = z.object({
  error: z.enum(['INVALID_INPUT', 'INVALID_CREDENTIALS', 'TOO_MANY_ATTEMPTS', 'ACCOUNT_DISABLED']),
})

/**
 * Exchanges phone + PIN for Supabase session tokens via the `pin-login` Edge
 * Function. The PIN is sent only in the POST body over HTTPS — never in a URL,
 * storage or logs.
 */
export async function requestPinLogin(credentials: LoginCredentials): Promise<SessionTokens> {
  const env = getPublicEnv()

  let response: Response
  try {
    response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/pin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ phone: credentials.phone, pin: credentials.pin }),
    })
  } catch {
    throw new LoginError('NETWORK')
  }

  const payload: unknown = await response.json().catch(() => null)

  if (response.ok) {
    const tokens = sessionTokensSchema.safeParse(payload)
    if (tokens.success) return tokens.data
    throw new LoginError('SERVER_ERROR')
  }

  const failure = errorResponseSchema.safeParse(payload)
  throw new LoginError(failure.success ? failure.data.error : 'SERVER_ERROR')
}
