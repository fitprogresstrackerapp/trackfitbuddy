import { z } from 'zod'

import { normalizeIndianPhone } from './lib/phone'

export const PIN_LENGTH = 4

export const pinSchema = z
  .string()
  .min(1, { error: 'Enter your PIN' })
  .regex(/^[0-9]{4}$/, { error: 'PIN must be exactly 4 digits' })

export const phoneSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter your phone number' })
  .transform((value, ctx) => {
    const normalized = normalizeIndianPhone(value)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' })
      return z.NEVER
    }
    return normalized
  })

export const loginSchema = z.object({ phone: phoneSchema, pin: pinSchema })

export type LoginCredentials = z.output<typeof loginSchema>
