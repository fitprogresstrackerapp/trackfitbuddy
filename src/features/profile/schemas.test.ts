import { describe, expect, it } from 'vitest'

import {
  capacitySchema,
  createBasicsSchema,
  createReviewSchema,
  createStepsEntrySchema,
  createWeightEntrySchema,
  GENDER_OPTIONS,
  goalSchema,
  heightSchema,
  lifestyleSchema,
  measurementsSchema,
} from './schemas'

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

describe('profile editing schemas', () => {
  const TODAY_EDIT = '2026-09-29'

  it('height reuses the onboarding bounds (metric only)', () => {
    expect(heightSchema.parse({ heightCm: '175' })).toEqual({ heightCm: 175 })
    expect(heightSchema.safeParse({ heightCm: '99' }).success).toBe(false)
    expect(heightSchema.safeParse({ heightCm: "5'9" }).success).toBe(false)
  })

  it('weight entries: range, decimals, date not in the future or older than 90 days', () => {
    const schema = createWeightEntrySchema(TODAY_EDIT)
    expect(schema.parse({ weightKg: '72.45', date: TODAY_EDIT })).toEqual({
      weightKg: 72.45,
      date: TODAY_EDIT,
    })
    expect(schema.safeParse({ weightKg: '0', date: TODAY_EDIT }).success).toBe(false)
    expect(schema.safeParse({ weightKg: 'NaN', date: TODAY_EDIT }).success).toBe(false)
    expect(firstError(schema.safeParse({ weightKg: '72', date: '2026-09-30' }))).toBe(
      'The date can’t be in the future',
    )
    expect(firstError(schema.safeParse({ weightKg: '72', date: '2026-06-30' }))).toBe(
      'Missing entries can be added for the last 90 days',
    )
  })

  it('steps: whole, non-negative, within the database maximum, not in the future', () => {
    const schema = createStepsEntrySchema(TODAY_EDIT)
    expect(schema.parse({ steps: '8420', date: TODAY_EDIT })).toEqual({
      steps: 8420,
      date: TODAY_EDIT,
    })
    expect(schema.parse({ steps: '0', date: TODAY_EDIT }).steps).toBe(0)
    expect(firstError(schema.safeParse({ steps: '-5', date: TODAY_EDIT }))).toBe(
      'Use a whole number of steps',
    )
    expect(firstError(schema.safeParse({ steps: '84.5', date: TODAY_EDIT }))).toBe(
      'Use a whole number of steps',
    )
    expect(firstError(schema.safeParse({ steps: '200001', date: TODAY_EDIT }))).toBe(
      'Steps must be at most 2,00,000',
    )
    expect(firstError(schema.safeParse({ steps: '100', date: '2026-10-01' }))).toBe(
      'The date can’t be in the future',
    )
  })

  it('lifestyle fields are optional; blanks are stored as not set', () => {
    expect(lifestyleSchema.parse({ activityLevel: '', job: '  ', hobbies: '' })).toEqual({
      activityLevel: null,
      job: null,
      hobbies: null,
    })
    expect(
      lifestyleSchema.parse({ activityLevel: 'VERY_ACTIVE', job: 'Engineer', hobbies: 'Cricket' })
        .activityLevel,
    ).toBe('VERY_ACTIVE')
    expect(
      lifestyleSchema.safeParse({ activityLevel: 'ATHLETE', job: '', hobbies: '' }).success,
    ).toBe(false)
    expect(
      lifestyleSchema.safeParse({ activityLevel: '', job: 'x'.repeat(201), hobbies: '' }).success,
    ).toBe(false)
  })

  it('goals: valid long-term goal, several distinct focuses, bounded objective', () => {
    expect(
      goalSchema.parse({
        longTermGoal: 'FAT_LOSS',
        focuses: ['ENDURANCE', 'FLEXIBILITY'],
        objective: '  Keep it simple ',
      }),
    ).toEqual({
      longTermGoal: 'FAT_LOSS',
      focuses: ['ENDURANCE', 'FLEXIBILITY'],
      objective: 'Keep it simple',
    })
    expect(
      goalSchema.parse({ longTermGoal: 'PERFORMANCE', focuses: [], objective: '' }).objective,
    ).toBeNull()
    expect(goalSchema.safeParse({ longTermGoal: '', focuses: [], objective: '' }).success).toBe(
      false,
    )
    expect(
      goalSchema.safeParse({ longTermGoal: 'FAT_LOSS', focuses: ['YOGA'], objective: '' }).success,
    ).toBe(false)
    expect(
      goalSchema.safeParse({
        longTermGoal: 'FAT_LOSS',
        focuses: ['ENDURANCE', 'ENDURANCE'],
        objective: '',
      }).success,
    ).toBe(false)
    expect(
      goalSchema.safeParse({ longTermGoal: 'FAT_LOSS', focuses: [], objective: 'x'.repeat(2001) })
        .success,
    ).toBe(false)
  })

  it('capacity is 2–6 days per week', () => {
    expect(capacitySchema.safeParse({ workoutDaysPerWeek: 5 }).success).toBe(true)
    expect(capacitySchema.safeParse({ workoutDaysPerWeek: 1 }).success).toBe(false)
    expect(capacitySchema.safeParse({ workoutDaysPerWeek: 7 }).success).toBe(false)
  })

  it('recommendation review: target ranges and a fixed session count', () => {
    const schema = createReviewSchema(3)
    const valid = {
      calories: '1900',
      proteinG: '150',
      carbsG: '220.5',
      fatG: '60',
      fiberG: '32',
      sessions: ['Push', 'Pull', 'Legs'],
    }
    expect(schema.parse(valid)).toMatchObject({
      calories: 1900,
      carbsG: 220.5,
      sessions: ['Push', 'Pull', 'Legs'],
    })
    expect(schema.safeParse({ ...valid, calories: '500' }).success).toBe(false)
    expect(schema.safeParse({ ...valid, calories: '1900.5' }).success).toBe(false)
    expect(schema.safeParse({ ...valid, proteinG: 'Infinity' }).success).toBe(false)
    expect(schema.safeParse({ ...valid, sessions: ['Push', 'Pull'] }).success).toBe(false)
    expect(schema.safeParse({ ...valid, sessions: ['Push', ' ', 'Legs'] }).success).toBe(false)
  })
})
