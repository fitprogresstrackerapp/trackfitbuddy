import { z } from 'zod'

/*
 * RecommendationInput (spec §35): the compact, versioned summary the AI
 * receives. The server builds it from the database only (input-builder.ts);
 * nothing here ever comes from a browser request.
 *
 * Semantics the prompt relies on:
 *   * `null` = unavailable/not measured, never zero;
 *   * all averages and adherence values are computed deterministically by
 *     the application (the AI never calculates them);
 *   * job, hobbies, goals.objective and feedback are user-written text:
 *     untrusted data.
 */

export const INPUT_SCHEMA_VERSION = 'recommendation-input-v1'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const count = z.number().int().nonnegative()
const amount = z.number()
const rate = z.number().min(0).max(1)

const nutrientSchema = z.strictObject({
  /** Average intake over tracked, completed days. */
  average: amount.nullable(),
  /** Average target over the same days. */
  target: amount.nullable(),
  days_met: count,
  eligible_days: count,
  /** days_met / eligible_days, using each day's own target snapshot. */
  adherence: rate.nullable(),
})

const changeSchema = z.strictObject({
  start: amount.nullable(),
  end: amount.nullable(),
  /** end − start; `null` with fewer than two measurements. */
  change: amount.nullable(),
})

export const periodSummarySchema = z.strictObject({
  start: isoDate,
  end: isoDate,
  days: count,
  nutrition: z.strictObject({
    tracked_days: count,
    calories: nutrientSchema,
    protein_g: nutrientSchema,
    carbs_g: nutrientSchema,
    fat_g: nutrientSchema,
    fiber_g: nutrientSchema,
  }),
  workouts: z.strictObject({
    /** Distinct days with at least one workout. */
    workout_days: count,
    sessions: count,
    minutes: count,
    calories: count,
    /** Completed full Monday–Sunday weeks judged against capacity. */
    full_weeks: count,
    days_completed: count,
    days_expected: count,
    adherence: rate.nullable(),
    types: z.record(z.string(), count),
  }),
  activities: z.strictObject({
    sessions: count,
    days: count,
    minutes: count,
    calories: count,
    types: z.record(z.string(), count),
  }),
  steps: z.strictObject({
    tracked_days: count,
    /** Average of days with an entry; missing days are not zero. */
    average: count.nullable(),
  }),
  body: z.strictObject({
    weight_kg: changeSchema,
    body_fat_percent: changeSchema,
    muscle_mass_kg: changeSchema,
  }),
})

export type PeriodSummary = z.infer<typeof periodSummarySchema>

const targetsSchema = z.strictObject({
  calories: amount,
  protein_g: amount,
  carbs_g: amount,
  fat_g: amount,
  fiber_g: amount,
})

export const recommendationInputSchema = z.strictObject({
  schema_version: z.literal(INPUT_SCHEMA_VERSION),
  /** The actual generation date in the user's timezone. */
  processing_date: isoDate,
  first_recommendation: z.boolean(),
  user: z.strictObject({
    age: z.number().int().nullable(),
    gender: z.string().nullable(),
    height_cm: amount.nullable(),
    current_weight_kg: amount.nullable(),
    current_weight_date: isoDate.nullable(),
    activity_level: z.string().nullable(),
    job: z.string().max(200).nullable(),
    hobbies: z.string().max(500).nullable(),
  }),
  goals: z.strictObject({
    long_term: z.string(),
    /** Highest priority first. */
    short_term: z.array(z.string()).max(7),
    objective: z.string().max(2000).nullable(),
  }),
  workout: z.strictObject({
    /** Capacity for the NEW cycle (the profile's current preference). */
    days_per_week: z.number().int().min(2).max(6),
  }),
  /** The cycle that ends as this one begins; `null` for a first recommendation. */
  previous_cycle: z
    .strictObject({
      /** Capacity the previous cycle was judged against (never rewritten). */
      workout_days_per_week: z.number().int().min(2).max(6),
      summary: periodSummarySchema,
    })
    .nullable(),
  /** First recommendation only: the last completed weeks, without targets. */
  recent_data: periodSummarySchema.nullable(),
  inbody: z
    .strictObject({
      date: isoDate,
      weight_kg: amount.nullable(),
      body_fat_percent: amount.nullable(),
      muscle_mass_kg: amount.nullable(),
    })
    .nullable(),
  previous_recommendation: z
    .strictObject({
      generated_on: isoDate,
      /** Final targets (after any user edits). */
      targets: targetsSchema,
      edited_by_user: z.boolean(),
      workout_template: z.array(z.strictObject({ name: z.string(), type: z.string().nullable() })),
      focus: z.array(z.string()),
      summary: z.string().nullable(),
    })
    .nullable(),
  /** This month's check-in (spec §31); frozen when processing claims the attempt. */
  feedback: z.string().max(2000).nullable(),
})

export type RecommendationInput = z.infer<typeof recommendationInputSchema>
