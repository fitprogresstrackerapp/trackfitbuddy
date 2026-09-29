import { describe, expect, it } from 'vitest'

import {
  macroCalories,
  outputJsonSchema,
  recommendationOutputSchema,
  validateRecommendation,
  type RecommendationOutput,
} from './output'

const VALID: RecommendationOutput = {
  assessment: 'Calorie adherence was 68%; protein was usually met.',
  targets: { calories: 2000, protein_g: 140, carbs_g: 220, fat_g: 60, fiber_g: 30 },
  long_term_goal: 'Fat loss stays the priority.',
  short_term_focus: ['MUSCLE_BUILDING', 'GENERAL_FITNESS'],
  workout_plan: {
    days_per_week: 4,
    sessions: [
      { name: 'Upper body', type: 'UPPER_BODY', focus: null },
      { name: 'Lower body', type: 'LOWER_BODY', focus: 'Squat pattern' },
      { name: 'Full body', type: 'FULL_BODY', focus: null },
      { name: 'Athletic', type: 'ATHLETIC_PERFORMANCE', focus: null },
    ],
  },
  activity_recommendation: 'Consider one easy walk on rest days.',
  nutrition_suggestions: ['Add a protein source to breakfast.'],
  improve: ['Log dinners consistently.'],
  watch: [],
  summary: 'Suggested 2,000 kcal and four sessions a week.',
}

const json = (value: unknown) => JSON.stringify(value)

describe('validateRecommendation', () => {
  it('accepts a valid, coherent recommendation', () => {
    const result = validateRecommendation(json(VALID), 4)
    expect(result).toEqual({ ok: true, value: VALID })
    // 140×4 + 220×4 + 60×9 = 1,980 ≈ 2,000
    expect(macroCalories(VALID.targets)).toBe(1980)
  })

  it('rejects malformed JSON (retryable)', () => {
    expect(validateRecommendation('{"assessment": "cut', 4)).toMatchObject({
      ok: false,
      code: 'MALFORMED_JSON',
      retryable: true,
    })
  })

  it.each([
    ['a missing field', { ...VALID, summary: undefined }],
    ['an unknown top-level field', { ...VALID, motivation: 'You got this!' }],
    ['a wrong type', { ...VALID, targets: { ...VALID.targets, calories: '2000' } }],
    ['a fractional calorie target', { ...VALID, targets: { ...VALID.targets, calories: 2000.5 } }],
    [
      'an unknown workout type',
      {
        ...VALID,
        workout_plan: {
          ...VALID.workout_plan,
          sessions: VALID.workout_plan.sessions.map((s, i) =>
            i === 0 ? { ...s, type: 'YOGA' } : s,
          ),
        },
      },
    ],
    ['an unknown focus', { ...VALID, short_term_focus: ['WEIGHT_LOSS'] }],
    ['an empty summary', { ...VALID, summary: '   ' }],
    ['an essay', { ...VALID, summary: 'x'.repeat(401) }],
    ['too many notes', { ...VALID, improve: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['a nested extra field', { ...VALID, targets: { ...VALID.targets, sodium_mg: 2300 } }],
  ])('rejects %s (schema, retryable)', (_label, value) => {
    expect(validateRecommendation(json(value), 4)).toMatchObject({
      ok: false,
      code: 'SCHEMA_INVALID',
      retryable: true,
    })
  })

  it.each([
    ['calories', 799],
    ['calories', 6001],
    ['protein_g', 501],
    ['carbs_g', 1001],
    ['fat_g', 401],
    ['fiber_g', 151],
    ['protein_g', -1],
  ] as const)('rejects %s = %d as out of range, without clamping', (key, value) => {
    const result = validateRecommendation(
      json({ ...VALID, targets: { ...VALID.targets, [key]: value } }),
      4,
    )
    expect(result).toMatchObject({ ok: false, code: 'TARGET_OUT_OF_RANGE', retryable: false })
  })

  it('accepts the range limits themselves', () => {
    const targets = { calories: 800, protein_g: 60, carbs_g: 90, fat_g: 20, fiber_g: 0 }
    expect(validateRecommendation(json({ ...VALID, targets }), 4).ok).toBe(true)
  })

  it('rejects macros that do not add up to the calories', () => {
    const result = validateRecommendation(
      json({ ...VALID, targets: { ...VALID.targets, calories: 2000, carbs_g: 400 } }),
      4,
    )
    expect(result).toMatchObject({ ok: false, code: 'MACRO_INCOHERENT', retryable: false })
  })

  it('allows rounding differences within the tolerance', () => {
    // 2,180 kcal from macros vs 2,000 target = 9 %.
    const targets = { ...VALID.targets, carbs_g: 270 }
    expect(validateRecommendation(json({ ...VALID, targets }), 4).ok).toBe(true)
  })

  it('the schedule must match the capacity exactly', () => {
    expect(validateRecommendation(json(VALID), 5)).toMatchObject({
      ok: false,
      code: 'SCHEDULE_INVALID',
    })
    const extra = {
      ...VALID,
      workout_plan: {
        days_per_week: 4,
        sessions: [...VALID.workout_plan.sessions, { name: 'Extra', type: 'CARDIO', focus: null }],
      },
    }
    expect(validateRecommendation(json(extra), 4)).toMatchObject({ code: 'SCHEDULE_INVALID' })
  })

  it('the schedule is a template: fixed weekdays are rejected', () => {
    const weekday = {
      ...VALID,
      workout_plan: {
        ...VALID.workout_plan,
        sessions: VALID.workout_plan.sessions.map((s, i) =>
          i === 1 ? { ...s, name: 'Wednesday legs' } : s,
        ),
      },
    }
    expect(validateRecommendation(json(weekday), 4)).toMatchObject({ code: 'SCHEDULE_INVALID' })
  })
})

describe('provider JSON schema', () => {
  const schema = outputJsonSchema()
  const text = JSON.stringify(schema)

  it('is derived from the Zod schema and forbids extra properties', () => {
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(Object.keys(recommendationOutputSchema.shape))
    expect(text).toContain('"UPPER_BODY"')
  })

  it('omits constraints structured outputs do not support (Zod still enforces them)', () => {
    for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'maxItems', '$schema']) {
      expect(text).not.toContain(`"${keyword}"`)
    }
  })
})
