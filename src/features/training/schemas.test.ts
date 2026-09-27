import { describe, expect, it } from 'vitest'

import { createTrainingSchema, type TrainingFormValues } from './schemas'

const TODAY = '2026-09-24'
const workout = createTrainingSchema('workout', TODAY)
const activity = createTrainingSchema('activity', TODAY)

const base: TrainingFormValues = {
  type: 'UPPER_BODY',
  name: '',
  duration: '45',
  manual: false,
  manualCalories: '',
  date: TODAY,
}

const firstError = (values: Partial<TrainingFormValues>, schema = workout) =>
  schema.safeParse({ ...base, ...values }).error?.issues[0]?.message

describe('training schema', () => {
  it('parses a predefined workout with an optional name', () => {
    expect(workout.parse({ ...base, name: '  Push Strength ' })).toEqual({
      type: 'UPPER_BODY',
      name: 'Push Strength',
      durationMinutes: 45,
      manualCalories: null,
      date: TODAY,
    })
    expect(workout.parse(base).name).toBeNull()
  })

  it('accepts only the kind’s own types', () => {
    expect(firstError({ type: 'YOGA' })).toBe('Select a type')
    expect(firstError({ type: 'CRICKET' })).toBe('Select a type')
    expect(activity.safeParse({ ...base, type: 'CRICKET' }).success).toBe(true)
    expect(firstError({ type: 'UPPER_BODY' }, activity)).toBe('Select a type')
  })

  it('requires a name for CUSTOM', () => {
    expect(firstError({ type: 'CUSTOM' })).toBe('Enter a name for a custom entry')
    expect(workout.safeParse({ ...base, type: 'CUSTOM', name: 'Mobility' }).success).toBe(true)
  })

  it.each([
    ['', 'Enter the duration'],
    ['0', 'Duration must be more than 0 minutes'],
    ['-5', 'Use whole minutes'],
    ['30.5', 'Use whole minutes'],
    ['1441', 'Duration must be at most 1440 minutes'],
  ])('rejects duration %j', (duration, message) => {
    expect(firstError({ duration })).toBe(message)
  })

  it('allows realistic long activities (a 4-hour cricket match)', () => {
    expect(activity.parse({ ...base, type: 'CRICKET', duration: '240' }).durationMinutes).toBe(240)
  })

  it('manual calories: optional, non-negative, used only when switched on', () => {
    expect(workout.parse({ ...base, manual: true, manualCalories: '350' }).manualCalories).toBe(350)
    expect(workout.parse({ ...base, manual: true, manualCalories: '0' }).manualCalories).toBe(0)
    expect(
      workout.parse({ ...base, manual: false, manualCalories: '350' }).manualCalories,
    ).toBeNull()
    expect(firstError({ manual: true, manualCalories: '' })).toBe('Enter the calories')
    expect(firstError({ manual: true, manualCalories: '-10' })).toBe(
      'Use a non-negative number with up to 1 decimal',
    )
    expect(firstError({ manual: true, manualCalories: 'abc' })).toBe(
      'Use a non-negative number with up to 1 decimal',
    )
    expect(firstError({ manual: true, manualCalories: '10001' })).toBe(
      'Calories must be at most 10,000',
    )
  })

  it('rejects future dates and dates outside the late-entry window', () => {
    expect(firstError({ date: '2026-09-25' })).toBe('The date can’t be in the future')
    expect(firstError({ date: '2026-02-30' })).toBe('Enter a valid date')
    expect(firstError({ date: '2026-06-25' })).toBe(
      'Missing entries can be added for the last 90 days',
    )
    expect(workout.safeParse({ ...base, date: '2026-06-26' }).success).toBe(true)
  })
})
