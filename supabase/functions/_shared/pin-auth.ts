/**
 * Server-side helpers for the phone + PIN login bridge.
 *
 * Shared by the `pin-login` Edge Function (Deno) and trusted Node scripts
 * (user provisioning, integration tests). Uses only Web Crypto so it runs in
 * both. NEVER import this from browser code — it handles the auth secret.
 *
 * Every account's Supabase Auth credential is:
 *   email    = `<user id>@phone-pin.invalid`   (synthetic, never delivered)
 *   password = HMAC-SHA256(PIN_AUTH_SECRET, "auth-password:v1:<user id>")
 * Nobody knows or types this password. It can only be derived by server code
 * holding PIN_AUTH_SECRET, and that code only does so after the PIN has been
 * verified (with lockout) by public.auth_verify_pin().
 */

export const AUTH_EMAIL_DOMAIN = 'phone-pin.invalid'

/** Canonical phone format stored in profiles.phone (E.164). */
export const E164_PHONE = /^\+[1-9][0-9]{7,14}$/

/** Exactly four digits. */
export const PIN_FORMAT = /^[0-9]{4}$/

const MIN_SECRET_LENGTH = 32

export function authEmailForUser(userId: string): string {
  return `${userId}@${AUTH_EMAIL_DOMAIN}`
}

export async function deriveAuthPassword(secret: string, userId: string): Promise<string> {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`PIN_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
  }
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`auth-password:v1:${userId}`),
  )
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}
