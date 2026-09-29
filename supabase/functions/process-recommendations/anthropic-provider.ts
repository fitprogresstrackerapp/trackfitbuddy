/**
 * Claude (Anthropic Messages API) behind the AIRecommendationProvider
 * abstraction. Server-side only: the API key comes from the Edge Function
 * environment and is never logged or returned.
 *
 *   * Structured output: output_config.format with a JSON schema derived from
 *     the Zod output schema. validateRecommendation() still checks the reply.
 *   * Refusals: server-side fallbacks ("default") let a policy decline be
 *     retried on Anthropic's recommended fallback model. The model that
 *     actually answered (response.model) is recorded.
 *   * No reasoning is requested or stored; only the final text is kept.
 *   * Retries are handled by the processor (bounded), so the SDK's own
 *     retries are disabled.
 */
import Anthropic from '@anthropic-ai/sdk'

import {
  ProviderError,
  type AIRecommendationProvider,
  type RecommendationGenerationOptions,
  type RecommendationGenerationResult,
} from '../../../src/features/recommendations/engine/provider.ts'
import type { RecommendationInput } from '../../../src/features/recommendations/engine/input.ts'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5'

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout')
  if (error instanceof Anthropic.RateLimitError) return new ProviderError('rate_limit')
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError('auth')
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ProviderError('bad_request')
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new ProviderError('unavailable')
  }
  if (error instanceof Anthropic.APIError && error.status === 529)
    return new ProviderError('unavailable')
  return new ProviderError('unknown')
}

export class AnthropicRecommendationProvider implements AIRecommendationProvider {
  readonly name = 'anthropic'
  readonly model: string
  private readonly apiKey: string

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey
    this.model = options.model
  }

  async generateRecommendation(
    input: RecommendationInput,
    options: RecommendationGenerationOptions,
  ): Promise<RecommendationGenerationResult> {
    const client = new Anthropic({ apiKey: this.apiKey, timeout: options.timeoutMs, maxRetries: 0 })
    let response
    try {
      response = await client.beta.messages.create({
        model: this.model,
        max_tokens: options.maxOutputTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: options.prompt.system,
        messages: [{ role: 'user', content: options.prompt.buildUserMessage(input) }],
        output_config: { format: { type: 'json_schema', schema: options.jsonSchema } },
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
    } catch (error) {
      throw toProviderError(error)
    }

    const rawText = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const usage = response.usage
    const inputTokens =
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)
    return {
      rawText,
      provider: this.name,
      model: response.model,
      inputTokens,
      outputTokens: usage.output_tokens,
      totalTokens: inputTokens + usage.output_tokens,
      actualCost: null,
      stopReason: response.stop_reason ?? null,
      requestId: (response as { _request_id?: string | null })._request_id ?? null,
    }
  }
}
