import type { Pricing } from './config.ts'
import { PROCESSING_CONCURRENCY } from './config.ts'
import { attemptReservation, estimateCost, priceFor } from './cost.ts'
import { buildRecommendationInput, InputNotReadyError, type InputSource } from './input-builder.ts'
import { INPUT_SCHEMA_VERSION, recommendationInputSchema } from './input.ts'
import { outputJsonSchema, validateRecommendation, type RecommendationOutput } from './output.ts'
import { getPrompt } from './prompts.ts'
import { ProviderError, toProviderError, type AIRecommendationProvider } from './provider.ts'

/*
 * Per-user processing (spec §34, §72–73; Prompt 10 §36, §71–72, §90).
 *
 *   load rows → build input (skip if not ready) → estimate cost → claim
 *   (budget lock, feedback frozen, PROCESSING) → provider call(s) → validate
 *   → complete (one transaction) or fail (raw output kept).
 *
 * The provider call cannot run inside a database transaction, so explicit
 * states make interruption recoverable: a crash leaves the attempt
 * PROCESSING, and stale recovery later marks it FAILED for an admin to retry.
 * Each user is independent; one failure never stops the batch.
 */

export type ProcessingMode = 'PROCESS' | 'RETRY' | 'REPROCESS'

export interface PendingAttempt {
  id: string
  userId: string
  runId: string
  mode: ProcessingMode
}

/** One row per provider request (ai_usage_records). */
export interface UsageEntry {
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number | null
  actual_cost: number | null
  succeeded: boolean
  error_message: string | null
}

export type ClaimResult =
  | { result: 'CLAIMED'; input: unknown }
  | { result: 'NOT_PENDING' | 'BUDGET_EXCEEDED' | 'BUDGET_NOT_CONFIGURED' }

export interface ClaimRequest {
  attemptId: string
  input: unknown
  estimatedCost: number
  provider: string
  model: string
  promptVersion: string
  pricingVersion: string
  inputSchemaVersion: string
  goalId: string
  capacity: number
}

export interface ProcessingRepository {
  /** Rows for one user, as of the user's local processing date. */
  loadSource(userId: string, mode: ProcessingMode): Promise<InputSource & { goalId: string | null }>
  claim(request: ClaimRequest): Promise<ClaimResult>
  skip(attemptId: string, reason: string): Promise<void>
  fail(attemptId: string, reason: string, rawOutput: unknown, usage: UsageEntry[]): Promise<void>
  /** Persists the recommendation atomically; returns the new cycle id. */
  complete(
    attemptId: string,
    rawOutput: unknown,
    parsed: RecommendationOutput,
    usage: UsageEntry[],
  ): Promise<string>
}

export interface ProcessorConfig {
  promptVersion: string
  maxOutputTokens: number
  timeoutSeconds: number
  maxRetries: number
  pricing: Pricing
}

/** Safe operational events only: ids, outcomes and concise reasons (never input text or secrets). */
export type ProcessingLogger = (event: string, details: Record<string, string | number>) => void

export interface ProcessorContext {
  repository: ProcessingRepository
  provider: AIRecommendationProvider
  config: ProcessorConfig
  log?: ProcessingLogger
}

export type AttemptOutcome = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'BUDGET' | 'NOT_PENDING' | 'ERROR'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderError('timeout'))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

function saveFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('Already has a recommendation'))
    return 'Already has a recommendation this month'
  if (message.includes('already covers today')) return 'A recommendation already covers today'
  return 'Could not save the recommendation'
}

export async function processAttempt(
  attempt: PendingAttempt,
  context: ProcessorContext,
): Promise<AttemptOutcome> {
  const { repository, provider, config } = context

  const source = await repository.loadSource(attempt.userId, attempt.mode)
  let input
  try {
    input = buildRecommendationInput(source)
  } catch (error) {
    if (error instanceof InputNotReadyError) {
      await repository.skip(attempt.id, error.message)
      return 'SKIPPED'
    }
    throw error
  }
  if (!source.goalId) throw new Error('Ready user without a goal id')

  const prompt = getPrompt(config.promptVersion)
  const price = priceFor(config.pricing, provider.model)
  if (!price) throw new Error('No pricing for the configured model')
  const estimate = attemptReservation(
    price,
    prompt.system + prompt.buildUserMessage(input),
    config.maxOutputTokens,
    config.maxRetries,
  )

  const claim = await repository.claim({
    attemptId: attempt.id,
    input,
    estimatedCost: estimate,
    provider: provider.name,
    model: provider.model,
    promptVersion: prompt.version,
    pricingVersion: config.pricing.version,
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    goalId: source.goalId,
    capacity: input.workout.days_per_week,
  })
  if (claim.result === 'NOT_PENDING') return 'NOT_PENDING'
  if (claim.result !== 'CLAIMED') return 'BUDGET'

  // The stored input (feedback frozen at claim time) is exactly what the AI receives.
  const frozen = recommendationInputSchema.parse(claim.input)
  const capacity = frozen.workout.days_per_week
  const timeoutMs = config.timeoutSeconds * 1000
  const jsonSchema = outputJsonSchema()
  const usage: UsageEntry[] = []
  let failure: { reason: string; raw: unknown } = { reason: 'Generation failed', raw: null }

  for (let request = 0; request <= config.maxRetries; request += 1) {
    let result
    try {
      result = await withTimeout(
        provider.generateRecommendation(frozen, {
          prompt,
          maxOutputTokens: config.maxOutputTokens,
          timeoutMs,
          jsonSchema,
        }),
        timeoutMs + 5000,
      )
    } catch (error) {
      const providerError = toProviderError(error)
      const inputTokens = providerError.inputTokens ?? 0
      const outputTokens = providerError.outputTokens ?? 0
      usage.push({
        provider: provider.name,
        model: provider.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost: estimateCost(price, inputTokens, outputTokens),
        actual_cost: null,
        succeeded: false,
        error_message: providerError.message,
      })
      failure = { reason: providerError.message, raw: { error: providerError.kind } }
      context.log?.('provider_error', { attempt: attempt.id, kind: providerError.kind })
      if (!providerError.retryable) break
      continue
    }

    const inputTokens = result.inputTokens ?? 0
    const outputTokens = result.outputTokens ?? 0
    const cost = estimateCost(
      priceFor(config.pricing, result.model) ?? price,
      inputTokens,
      outputTokens,
    )
    const raw = {
      text: result.rawText,
      stop_reason: result.stopReason,
      request_id: result.requestId,
      model: result.model,
    }
    const entry = (succeeded: boolean, message: string | null): UsageEntry => ({
      provider: result.provider,
      model: result.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: cost,
      actual_cost: result.actualCost,
      succeeded,
      error_message: message,
    })

    if (result.stopReason === 'refusal' || result.stopReason === 'max_tokens') {
      const reason =
        result.stopReason === 'refusal'
          ? 'Provider declined the request'
          : 'AI output hit the output token limit'
      usage.push(entry(false, reason))
      failure = { reason, raw }
      break
    }

    const validation = validateRecommendation(result.rawText, capacity)
    if (validation.ok) {
      usage.push(entry(true, null))
      try {
        await repository.complete(attempt.id, raw, validation.value, usage)
        return 'SUCCESS'
      } catch (error) {
        failure = { reason: saveFailureReason(error), raw }
        break
      }
    }
    usage.push(entry(false, validation.reason))
    failure = {
      reason: validation.reason,
      raw: { ...raw, validation: { code: validation.code, issues: validation.issues } },
    }
    context.log?.('invalid_output', { attempt: attempt.id, code: validation.code })
    if (!validation.retryable) break
  }

  await repository.fail(attempt.id, failure.reason, failure.raw, usage)
  return 'FAILED'
}

export interface BatchResult {
  processed: number
  success: number
  failed: number
  skipped: number
  errors: number
  /** Budget reached: the remaining attempts stay PENDING. */
  stoppedByBudget: boolean
  /** Time budget reached: unstarted attempts stay PENDING for the next call. */
  stoppedByTime: boolean
}

/**
 * Processes attempts with bounded concurrency. Every user is isolated: an
 * exception is counted and the batch continues. Once the budget refuses a
 * claim, or the time budget (`deadline`, epoch ms) has passed, no further
 * attempts are started; they stay PENDING.
 */
export async function processBatch(
  attempts: readonly PendingAttempt[],
  context: ProcessorContext,
  options: { concurrency?: number; deadline?: number; now?: () => number } = {},
): Promise<BatchResult> {
  const concurrency = options.concurrency ?? PROCESSING_CONCURRENCY
  const now = options.now ?? Date.now
  const result: BatchResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: 0,
    stoppedByBudget: false,
    stoppedByTime: false,
  }
  const queue = [...attempts]

  async function worker() {
    for (;;) {
      if (result.stoppedByBudget) return
      if (options.deadline !== undefined && queue.length > 0 && now() >= options.deadline) {
        result.stoppedByTime = true
        return
      }
      const attempt = queue.shift()
      if (!attempt) return
      let outcome: AttemptOutcome
      try {
        outcome = await processAttempt(attempt, context)
      } catch {
        outcome = 'ERROR'
      }
      context.log?.('attempt', { attempt: attempt.id, outcome })
      switch (outcome) {
        case 'SUCCESS':
          result.success += 1
          break
        case 'FAILED':
          result.failed += 1
          break
        case 'SKIPPED':
          result.skipped += 1
          break
        case 'BUDGET':
          result.stoppedByBudget = true
          continue
        case 'ERROR':
          result.errors += 1
          break
        case 'NOT_PENDING':
          continue
      }
      result.processed += 1
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, attempts.length)) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return result
}
