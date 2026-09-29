/**
 * Provider selection. Business logic only sees AIRecommendationProvider.
 *
 *   * Operational choice: system_settings.ai_provider / ai_model.
 *   * Local development and tests: the Edge Function env AI_PROVIDER (and
 *     optional AI_MODEL) overrides it, e.g. AI_PROVIDER=mock. Tests never
 *     call a real AI.
 *   * Secrets (ANTHROPIC_API_KEY) come only from the function environment.
 *     They are never read from the database or a request, and never logged.
 */
import {
  MOCK_MODEL,
  MOCK_PROVIDER,
  MockRecommendationProvider,
  type AIRecommendationProvider,
} from '../../../src/features/recommendations/engine/provider.ts'
import type { OperationalConfig } from '../../../src/features/recommendations/engine/config.ts'
import { AnthropicRecommendationProvider, ANTHROPIC_DEFAULT_MODEL } from './anthropic-provider.ts'

export const PROVIDERS = [MOCK_PROVIDER, 'anthropic'] as const

const DEFAULT_MODELS: Record<string, string> = {
  [MOCK_PROVIDER]: MOCK_MODEL,
  anthropic: ANTHROPIC_DEFAULT_MODEL,
}

interface Env {
  get(key: string): string | undefined
}

export function resolveProvider(
  config: Pick<OperationalConfig, 'provider' | 'model'>,
  env: Env,
): { provider: string; model: string } | null {
  const override = env.get('AI_PROVIDER')?.trim()
  if (override) {
    return {
      provider: override,
      model: env.get('AI_MODEL')?.trim() || (DEFAULT_MODELS[override] ?? ''),
    }
  }
  if (!config.provider) return null
  return { provider: config.provider, model: config.model ?? DEFAULT_MODELS[config.provider] ?? '' }
}

/** `null` when the provider is unknown or its secret is missing. */
export function createProvider(
  settings: { provider: string; model: string },
  env: Env,
): AIRecommendationProvider | null {
  if (!settings.model) return null
  switch (settings.provider) {
    case MOCK_PROVIDER:
      return new MockRecommendationProvider(settings.model)
    case 'anthropic': {
      const apiKey = env.get('ANTHROPIC_API_KEY')
      if (!apiKey) return null
      return new AnthropicRecommendationProvider({ apiKey, model: settings.model })
    }
    default:
      return null
  }
}
