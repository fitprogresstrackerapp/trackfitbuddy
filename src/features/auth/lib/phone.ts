/**
 * Indian mobile numbers. The canonical stored form is E.164: `+91` followed by
 * the 10-digit subscriber number (which starts with 6, 7, 8 or 9).
 *
 * Accepted input (spaces, dashes, dots and parentheses are ignored):
 *   98765 43210 · 098765 43210 · 91 98765 43210 · +91 98765-43210
 */
export const INDIA_COUNTRY_CODE = '+91'

const SUBSCRIBER_NUMBER = /^[6-9][0-9]{9}$/

export function normalizeIndianPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, '')
  let digits: string

  if (compact.startsWith('+')) {
    if (!compact.startsWith(INDIA_COUNTRY_CODE)) return null
    digits = compact.slice(INDIA_COUNTRY_CODE.length)
  } else if (compact.length === 12 && compact.startsWith('91')) {
    digits = compact.slice(2)
  } else if (compact.length === 11 && compact.startsWith('0')) {
    digits = compact.slice(1)
  } else {
    digits = compact
  }

  return SUBSCRIBER_NUMBER.test(digits) ? `${INDIA_COUNTRY_CODE}${digits}` : null
}

/** `+919876543210` → `98765 43210` (display only). */
export function formatIndianPhone(e164: string): string {
  const digits = e164.startsWith(INDIA_COUNTRY_CODE) ? e164.slice(INDIA_COUNTRY_CODE.length) : e164
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : e164
}
