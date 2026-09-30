import { z } from 'zod'

import { isPlausibleGroupCode, normalizeGroupCode } from './lib/groups-logic'

/** Mirrors the database: name 1–60 characters, optional description up to 500. */
export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter a group name' })
    .max(60, { error: 'Use at most 60 characters' }),
  description: z
    .string()
    .trim()
    .max(500, { error: 'Use at most 500 characters' })
    .transform((value) => (value.length === 0 ? null : value)),
})

export type CreateGroupInput = z.output<typeof createGroupSchema>

export const joinCodeSchema = z.object({
  code: z
    .string()
    .transform(normalizeGroupCode)
    .refine((code) => code.length > 0, { error: 'Enter the group code' })
    .refine(isPlausibleGroupCode, { error: 'Enter the 8-character code you were given' }),
})
