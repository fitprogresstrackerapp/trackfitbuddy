import type { RecommendationInput } from './input.ts'
import {
  FOCUS_VALUES,
  macroCalories,
  type RecommendationOutput,
  type SESSION_TYPES,
} from './output.ts'
import type { PromptTemplate } from './prompts.ts'

/*
 * AI provider abstraction (spec §37). Business logic depends only on this
 * interface. A provider sends the versioned prompt with the server-built
 * input and returns the raw text plus token usage. Parsing and validation
 * happen afterwards in validateRecommendation(), the same for every provider.
 *
 * Providers:
 *   * mock: deterministic, no network (local development and every test);
 *   * anthropic: supabase/functions/_shared/recommendations/anthropic-provider.ts
 *     (Deno only, API key from the Edge Function environment).
 */

export interface RecommendationGenerationOptions {
  prompt: PromptTemplate
  maxOutputTokens: number
  timeoutMs: number
  /** Structured-output JSON schema (see outputJsonSchema()). */
  jsonSchema: Record<string, unknown>
}

export interface RecommendationGenerationResult {
  /** Raw model text: stored as-is, validated separately. */
  rawText: string
  provider: string
  /** The model that actually served the request. */
  model: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** Provider-reported cost, if any. Otherwise cost is estimated from pricing. */
  actualCost: number | null
  stopReason: string | null
  requestId: string | null
}

export interface AIRecommendationProvider {
  readonly name: string
  readonly model: string
  generateRecommendation(
    input: RecommendationInput,
    options: RecommendationGenerationOptions,
  ): Promise<RecommendationGenerationResult>
}

export type ProviderErrorKind =
  'timeout' | 'rate_limit' | 'unavailable' | 'auth' | 'refused' | 'bad_request' | 'unknown'

const PROVIDER_ERROR_REASONS: Record<ProviderErrorKind, string> = {
  timeout: 'Provider timeout',
  rate_limit: 'Provider rate limit',
  unavailable: 'Provider unavailable',
  auth: 'Provider authentication failed',
  refused: 'Provider declined the request',
  bad_request: 'Provider rejected the request',
  unknown: 'Provider error',
}

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(['timeout', 'rate_limit', 'unavailable'])

/** A provider failure with a safe, concise reason (never a secret or stack). */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly retryable: boolean
  readonly inputTokens: number | null
  readonly outputTokens: number | null

  constructor(
    kind: ProviderErrorKind,
    options: { inputTokens?: number | null; outputTokens?: number | null } = {},
  ) {
    super(PROVIDER_ERROR_REASONS[kind])
    this.name = 'ProviderError'
    this.kind = kind
    this.retryable = RETRYABLE.has(kind)
    this.inputTokens = options.inputTokens ?? null
    this.outputTokens = options.outputTokens ?? null
  }
}

export function toProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError('unknown')
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

export const MOCK_PROVIDER = 'mock'
export const MOCK_MODEL = 'mock-recommender-1'

/**
 * Test scenarios for the mock provider only, selected by a marker in the
 * user's feedback, e.g. "[mock:timeout]". The real provider ignores these
 * markers (they are just text).
 */
export const MOCK_SCENARIOS = [
  'timeout',
  'rate_limit',
  'unavailable',
  'auth',
  'refused',
  'invalid_json',
  'schema_invalid',
  'out_of_range',
  'macro_incoherent',
  'wrong_sessions',
  'weekday',
  'flaky_json',
] as const

export type MockScenario = (typeof MOCK_SCENARIOS)[number]

export function mockScenarioOf(input: RecommendationInput): MockScenario | null {
  const match = /\[mock:([a-z_]+)\]/.exec(input.feedback ?? '')
  const scenario = match?.[1]
  return (MOCK_SCENARIOS as readonly string[]).includes(scenario ?? '')
    ? (scenario as MockScenario)
    : null
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4)

/** A plausible, internally coherent plan derived only from the input. */
export function mockRecommendation(input: RecommendationInput): RecommendationOutput {
  const previous = input.previous_recommendation?.targets
  const weight = input.user.current_weight_kg
  const calories = previous
    ? Math.round(previous.calories / 10) * 10 + 50
    : weight !== null
      ? Math.min(3500, Math.max(1400, Math.round((weight * 30) / 10) * 10))
      : 2000
  const protein = Math.round(Math.min(220, (weight ?? 70) * 1.8))
  const fat = Math.round((calories * 0.25) / 9)
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))
  const rotation = [
    'UPPER_BODY',
    'LOWER_BODY',
    'FULL_BODY',
    'CARDIO',
    'ATHLETIC_PERFORMANCE',
    'HIIT',
  ]
  const names: Record<string, string> = {
    UPPER_BODY: 'Upper body strength',
    LOWER_BODY: 'Lower body strength',
    FULL_BODY: 'Full body',
    CARDIO: 'Steady cardio',
    ATHLETIC_PERFORMANCE: 'Athletic conditioning',
    HIIT: 'Intervals',
  }
  const capacity = input.workout.days_per_week
  const sessions = Array.from({ length: capacity }, (_, index) => {
    const type = rotation[index % rotation.length] ?? 'FULL_BODY'
    return {
      name: names[type] ?? 'Session',
      type: type as (typeof SESSION_TYPES)[number],
      focus: null,
    }
  })
  const focus = input.goals.short_term
    .map((value) => value.toUpperCase())
    .filter((value): value is (typeof FOCUS_VALUES)[number] =>
      (FOCUS_VALUES as readonly string[]).includes(value),
    )
    .slice(0, 3)

  return {
    assessment: input.first_recommendation
      ? 'First recommendation, based on your profile and recent records.'
      : 'Based on your recent data, the previous plan is adjusted gradually.',
    targets: { calories, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: 30 },
    long_term_goal: `Keep working toward ${input.goals.long_term.replace(/_/g, ' ')}.`,
    short_term_focus: focus,
    workout_plan: { days_per_week: capacity, sessions },
    activity_recommendation: null,
    nutrition_suggestions: ['Consider spreading protein across your meals.'],
    improve: ['Log meals on most days so targets reflect your intake.'],
    watch: [],
    summary: `Suggested target ${String(calories)} kcal with ${String(capacity)} workout days per week.`,
  }
}

function scenarioOutput(scenario: MockScenario | null, input: RecommendationInput, call: number) {
  const base = mockRecommendation(input)
  switch (scenario) {
    case 'invalid_json':
      return '{"assessment": "cut off'
    case 'flaky_json':
      return call === 1 ? '{"assessment": "cut off' : JSON.stringify(base)
    case 'schema_invalid': {
      const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'summary'))
      return JSON.stringify({ ...rest, motivation: 'You can do it!' })
    }
    case 'out_of_range':
      return JSON.stringify({ ...base, targets: { ...base.targets, calories: 12000 } })
    case 'macro_incoherent': {
      const targets = { ...base.targets, protein_g: 400, carbs_g: 500, fat_g: 150 }
      return macroCalories(targets) > base.targets.calories * 1.2
        ? JSON.stringify({ ...base, targets })
        : JSON.stringify(base)
    }
    case 'wrong_sessions':
      return JSON.stringify({
        ...base,
        workout_plan: {
          days_per_week: input.workout.days_per_week + 1,
          sessions: [...base.workout_plan.sessions, { name: 'Extra', type: 'CARDIO', focus: null }],
        },
      })
    case 'weekday': {
      const [first, ...rest] = base.workout_plan.sessions
      return JSON.stringify({
        ...base,
        workout_plan: {
          ...base.workout_plan,
          sessions: first ? [{ ...first, name: 'Monday upper body' }, ...rest] : rest,
        },
      })
    }
    default:
      return JSON.stringify(base)
  }
}

/** Deterministic provider for local development and tests. Never calls a network. */
export class MockRecommendationProvider implements AIRecommendationProvider {
  readonly name = MOCK_PROVIDER
  readonly model: string
  private readonly calls = new Map<string, number>()

  constructor(model: string = MOCK_MODEL) {
    this.model = model
  }

  generateRecommendation(
    input: RecommendationInput,
    options: RecommendationGenerationOptions,
  ): Promise<RecommendationGenerationResult> {
    const scenario = mockScenarioOf(input)
    const key = JSON.stringify(input)
    const call = (this.calls.get(key) ?? 0) + 1
    this.calls.set(key, call)

    const inputTokens = estimateTokens(
      options.prompt.system + options.prompt.buildUserMessage(input),
    )
    switch (scenario) {
      case 'timeout':
      case 'rate_limit':
      case 'unavailable':
      case 'auth':
        return Promise.reject(new ProviderError(scenario))
      case 'refused':
        return Promise.reject(new ProviderError('refused', { inputTokens, outputTokens: 0 }))
      default:
        break
    }
    const rawText = scenarioOutput(scenario, input, call)
    const outputTokens = Math.min(options.maxOutputTokens, estimateTokens(rawText))
    return Promise.resolve({
      rawText,
      provider: this.name,
      model: this.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      actualCost: null,
      stopReason: 'end_turn',
      requestId: `mock-${String(call)}`,
    })
  }
}
