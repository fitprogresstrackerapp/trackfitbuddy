import { z } from 'zod'

import { MACRO_TOLERANCE, TARGET_RANGES, type TargetKey } from './config.ts'

/*
 * AI output contract (spec §36) and its validation (spec §74; Prompt 10
 * §29–33). The model's output is never trusted:
 *   1. it must be JSON;
 *   2. it must match the strict schema (no extra fields, allowed enums);
 *   3. business rules: target ranges (same as the review form), macro
 *      coherence and a schedule of exactly the user's capacity with no fixed
 *      weekdays.
 * Invalid output is rejected, never clamped or rewritten.
 */

/** Allowed session types: the workout types the app can log (spec §14). */
export const SESSION_TYPES = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'LEGS',
  'CHEST_TRICEPS',
  'BACK_BICEPS',
  'SHOULDERS_ARMS',
  'UPPER_BODY',
  'LOWER_BODY',
  'FULL_BODY',
  'HIIT',
  'CARDIO',
  'ATHLETIC_PERFORMANCE',
  'CUSTOM',
] as const

/** Short-term focus values (goal_focuses.focus_type). */
export const FOCUS_VALUES = [
  'MUSCLE_BUILDING',
  'RECOMPOSITION',
  'CRICKET_PERFORMANCE',
  'BADMINTON_PERFORMANCE',
  'FLEXIBILITY',
  'ENDURANCE',
  'GENERAL_FITNESS',
] as const

const text = (max: number) => z.string().trim().min(1).max(max)
const notes = z.array(text(200)).max(5)

export const recommendationOutputSchema = z.strictObject({
  assessment: text(600),
  targets: z.strictObject({
    calories: z.number().int(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
    fiber_g: z.number(),
  }),
  long_term_goal: text(300),
  short_term_focus: z.array(z.enum(FOCUS_VALUES)).max(3),
  workout_plan: z.strictObject({
    days_per_week: z.number().int(),
    sessions: z
      .array(
        z.strictObject({
          name: text(60),
          type: z.enum(SESSION_TYPES),
          focus: text(120).nullable(),
        }),
      )
      .min(1)
      .max(7),
  }),
  activity_recommendation: text(300).nullable(),
  nutrition_suggestions: notes,
  improve: notes,
  watch: notes,
  summary: text(400),
})

export type RecommendationOutput = z.infer<typeof recommendationOutputSchema>

// Constraints the provider's structured-output grammar does not support; the
// Zod schema above still enforces them after the response arrives.
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'pattern',
  'format',
])

function stripUnsupported(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupported)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
      .map(([key, child]) => [key, stripUnsupported(child)]),
  )
}

/** JSON Schema for provider structured output, derived from the Zod schema. */
export function outputJsonSchema(): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(recommendationOutputSchema, { io: 'input' })) as Record<
    string,
    unknown
  >
}

export type ValidationCode =
  | 'MALFORMED_JSON'
  | 'SCHEMA_INVALID'
  | 'TARGET_OUT_OF_RANGE'
  | 'MACRO_INCOHERENT'
  | 'SCHEDULE_INVALID'

export type ValidationResult =
  | { ok: true; value: RecommendationOutput }
  | {
      ok: false
      code: ValidationCode
      /** Concise, admin-facing reason. */
      reason: string
      issues: string[]
      /** Worth one more provider attempt (structural glitches), not business failures. */
      retryable: boolean
    }

const WEEKDAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i

const TARGET_LABELS: Record<TargetKey, string> = {
  calories: 'calories',
  protein_g: 'protein',
  carbs_g: 'carbs',
  fat_g: 'fat',
  fiber_g: 'fiber',
}

/** Calories implied by the macros (protein 4, carbs 4, fat 9 kcal/g). */
export function macroCalories(targets: { protein_g: number; carbs_g: number; fat_g: number }) {
  return targets.protein_g * 4 + targets.carbs_g * 4 + targets.fat_g * 9
}

export function validateRecommendation(rawText: string, capacity: number): ValidationResult {
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return {
      ok: false,
      code: 'MALFORMED_JSON',
      reason: 'Malformed AI output (not valid JSON)',
      issues: [],
      retryable: true,
    }
  }

  const parsed = recommendationOutputSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'SCHEMA_INVALID',
      reason: 'AI output did not match the recommendation schema',
      issues: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      retryable: true,
    }
  }
  const output = parsed.data

  for (const key of Object.keys(TARGET_RANGES) as TargetKey[]) {
    const { min, max } = TARGET_RANGES[key]
    const value = output.targets[key]
    if (value < min || value > max) {
      return {
        ok: false,
        code: 'TARGET_OUT_OF_RANGE',
        reason: `Target out of range: ${TARGET_LABELS[key]}`,
        issues: [`targets.${key}: ${String(value)} is outside ${String(min)}–${String(max)}`],
        retryable: false,
      }
    }
  }

  const implied = macroCalories(output.targets)
  const deviation = Math.abs(implied - output.targets.calories) / output.targets.calories
  if (deviation > MACRO_TOLERANCE) {
    return {
      ok: false,
      code: 'MACRO_INCOHERENT',
      reason: 'Macros do not add up to the calorie target',
      issues: [
        `protein×4 + carbs×4 + fat×9 = ${String(Math.round(implied))} kcal vs ${String(output.targets.calories)} kcal`,
      ],
      retryable: false,
    }
  }

  const { sessions, days_per_week } = output.workout_plan
  const scheduleIssues: string[] = []
  if (days_per_week !== capacity) {
    scheduleIssues.push(
      `days_per_week is ${String(days_per_week)}, capacity is ${String(capacity)}`,
    )
  }
  if (sessions.length !== capacity) {
    scheduleIssues.push(`${String(sessions.length)} sessions for a capacity of ${String(capacity)}`)
  }
  for (const session of sessions) {
    if (WEEKDAY.test(session.name) || (session.focus !== null && WEEKDAY.test(session.focus))) {
      scheduleIssues.push(`"${session.name}" names a fixed weekday`)
    }
  }
  if (scheduleIssues.length > 0) {
    return {
      ok: false,
      code: 'SCHEDULE_INVALID',
      reason: `Workout plan must have exactly ${String(capacity)} sessions without fixed weekdays`,
      issues: scheduleIssues,
      retryable: false,
    }
  }

  return { ok: true, value: output }
}
