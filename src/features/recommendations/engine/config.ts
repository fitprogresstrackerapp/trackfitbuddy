import { z } from 'zod'

/*
 * Recommendation engine configuration (spec §77, Prompt 10 §100).
 *
 * The engine runs in the process-recommendations Edge Function (Deno), and
 * Vitest tests it directly, so this folder uses only relative `.ts` imports
 * and zod.
 *
 * Secret configuration (provider API keys) is read by the Edge Function from
 * its environment and never appears here. Operational configuration comes
 * from system_settings; the values below are only fallbacks and fixed rules.
 */

export const DEFAULT_PROMPT_VERSION = 'recommendation-v1'

/**
 * Valid final targets. The review form (profile/schemas.ts) and
 * review_recommendation() use the same ranges.
 */
export const TARGET_RANGES = {
  calories: { min: 800, max: 6000 },
  protein_g: { min: 0, max: 500 },
  carbs_g: { min: 0, max: 1000 },
  fat_g: { min: 0, max: 400 },
  fiber_g: { min: 0, max: 150 },
} as const

export type TargetKey = keyof typeof TARGET_RANGES

/**
 * Macro coherence: protein × 4 + carbs × 4 + fat × 9 may differ from the
 * calorie target by at most this fraction (rounding, fiber, intent).
 */
export const MACRO_TOLERANCE = 0.15

/** First recommendation: recent data is summarised over this many completed days. */
export const RECENT_DAYS = 28

/** A previous cycle is analysed over at most this many days (the nutrition query limit). */
export const MAX_ANALYSIS_DAYS = 366

/** Users generated in parallel within one batch. */
export const PROCESSING_CONCURRENCY = 3

/** Conservative characters-per-token ratio for pre-call cost estimates. */
export const CHARS_PER_TOKEN_ESTIMATE = 3

export const pricingSchema = z.object({
  version: z.string().min(1).max(40),
  currency: z.string().regex(/^[A-Z]{3}$/),
  models: z.record(
    z.string(),
    z.object({
      input_per_million: z.number().nonnegative(),
      output_per_million: z.number().nonnegative(),
    }),
  ),
})

export type Pricing = z.infer<typeof pricingSchema>

export interface OperationalConfig {
  enabled: boolean
  provider: string | null
  model: string | null
  promptVersion: string
  batchSize: number
  maxOutputTokens: number
  timeoutSeconds: number
  maxRetries: number
  staleMinutes: number
  /** `null` = not configured: processing must not start. */
  budget: number | null
  currency: string
  pricing: Pricing | null
}

const int = (min: number, max: number, fallback: number) =>
  z.number().int().min(min).max(max).catch(fallback)

const settingsSchema = z.object({
  ai_enabled: z.boolean().catch(false),
  ai_provider: z.string().min(1).nullable().catch(null),
  ai_model: z.string().min(1).nullable().catch(null),
  ai_prompt_version: z
    .string()
    .regex(/^recommendation-v\d+$/)
    .catch(DEFAULT_PROMPT_VERSION),
  ai_batch_size: int(1, 100, 12),
  ai_max_output_tokens: int(256, 16000, 4000),
  ai_request_timeout_seconds: int(5, 300, 90),
  ai_max_retries: int(0, 3, 1),
  ai_stale_processing_minutes: int(5, 1440, 15),
  ai_monthly_budget: z.number().nonnegative().nullable().catch(null),
  ai_budget_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .catch('INR'),
  ai_pricing: pricingSchema.nullable().catch(null),
})

/** Operational configuration from system_settings rows; invalid values fall back safely. */
export function parseOperationalConfig(
  rows: readonly { key: string; value_json: unknown }[],
): OperationalConfig {
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value_json]))
  const settings = settingsSchema.parse(values)
  return {
    enabled: settings.ai_enabled,
    provider: settings.ai_provider,
    model: settings.ai_model,
    promptVersion: settings.ai_prompt_version,
    batchSize: settings.ai_batch_size,
    maxOutputTokens: settings.ai_max_output_tokens,
    timeoutSeconds: settings.ai_request_timeout_seconds,
    maxRetries: settings.ai_max_retries,
    staleMinutes: settings.ai_stale_processing_minutes,
    budget: settings.ai_monthly_budget,
    currency: settings.ai_budget_currency,
    pricing: settings.ai_pricing,
  }
}

export const SETTING_KEYS = [
  'ai_enabled',
  'ai_provider',
  'ai_model',
  'ai_prompt_version',
  'ai_batch_size',
  'ai_max_output_tokens',
  'ai_request_timeout_seconds',
  'ai_max_retries',
  'ai_stale_processing_minutes',
  'ai_monthly_budget',
  'ai_budget_currency',
  'ai_pricing',
] as const
