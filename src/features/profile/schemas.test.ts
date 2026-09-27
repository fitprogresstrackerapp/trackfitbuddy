import { describe, expect, it } from 'vitest'

import { createBasicsSchema, GENDER_OPTIONS, measurementsSchema } from './schemas'

const TODAY = '2026-09-28'
const basics = createBasicsSchema(TODAY)
const validBasics = { name: 'Asha', dateOfBirth: '1994-05-17', gender: 'FEMALE' }

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message
}

describe('basics (step 1)', () => {
  it('accepts valid input and trims the name', () => {
    expect(basics.parse({ ...validBasics, name: '  Asha  ' })).toEqual(validBasics)
  })

  it('offers exactly the four required gender options', () => {
    expect(GENDER_OPTIONS.map((option) => option.label)).toEqual([
      'Male',
      'Female',
      'Other',
      'Prefer not to say',
    ])
    for (const option of GENDER_OPTIONS) {
      expect(basics.safeParse({ ...validBasics, gender: option.value }).success).toBe(true)
    }
    expect(basics.safeParse({ ...validBasics, gender: 'UNKNOWN' }).success).toBe(false)
    expect(basics.safeParse({ ...validBasics, gender: '' }).success).toBe(false)
  })

  it('requires a name', () => {
    expect(firstError(basics.safeParse({ ...validBasics, name: '   ' }))).toBe('Enter your name')
  })

  it.each([
    ['', 'Enter your date of birth'],
    ['2026-02-30', 'Enter a valid date'],
    ['not-a-date', 'Enter a valid date'],
    ['2026-09-28', 'Date of birth must be in the past'],
    ['2030-01-01', 'Date of birth must be in the past'],
    ['2020-01-01', 'Age must be between 13 and 100'],
    ['1900-01-01', 'Age must be between 13 and 100'],
  ])('rejects date of birth %j', (dateOfBirth, message) => {
    expect(firstError(basics.safeParse({ ...validBasics, dateOfBirth }))).toBe(message)
  })

  it('accepts the age boundaries', () => {
    expect(basics.safeParse({ ...validBasics, dateOfBirth: '2013-09-28' }).success).toBe(true) // 13 today
    expect(basics.safeParse({ ...validBasics, dateOfBirth: '1926-09-29' }).success).toBe(true) // 99
  })
})

describe('measurements (step 2)', () => {
  it('parses valid metric values', () => {
    expect(measurementsSchema.parse({ heightCm: '175.5', weightKg: '72.35' })).toEqual({
      heightCm: 175.5,
      weightKg: 72.35,
    })
  })

  it.each(['', '0', '-170', '99', '251', 'abc', '170.55', '5ft'])(
    'rejects height %j',
    (heightCm) => {
      expect(measurementsSchema.safeParse({ heightCm, weightKg: '70' }).success).toBe(false)
    },
  )

  it.each(['', '0', '-70', '24.9', '300.5', 'seventy', '70.123'])(
    'rejects weight %j',
    (weightKg) => {
      expect(measurementsSchema.safeParse({ heightCm: '170', weightKg }).success).toBe(false)
    },
  )

  it('explains the valid range', () => {
    expect(firstError(measurementsSchema.safeParse({ heightCm: '260', weightKg: '70' }))).toBe(
      'Height must be between 100 and 250 cm',
    )
  })
})
