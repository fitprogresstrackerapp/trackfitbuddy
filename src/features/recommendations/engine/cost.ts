import { CHARS_PER_TOKEN_ESTIMATE, type Pricing } from './config.ts'

/*
 * Cost estimation (spec §39–40; Prompt 10 §40–42, §76). Prices come from the
 * versioned ai_pricing setting, never from code. Costs computed here are
 * "estimated". A provider-reported cost is stored separately as actual_cost.
 *
 * The authoritative budget check is claim_recommendation_attempt() in the
 * database: it runs under a lock, so concurrent admins cannot overspend.
 * fitsBudget() states the same rule for the UI and tests.
 */

export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
}

export function priceFor(pricing: Pricing | null, model: string): ModelPrice | null {
  const price = pricing?.models[model]
  return price
    ? { inputPerMillion: price.input_per_million, outputPerMillion: price.output_per_million }
    : null
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

export function estimateCost(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return round6(
    (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000,
  )
}

/** Conservative input-token estimate before the call. */
export function estimateInputTokens(promptText: string): number {
  return Math.ceil(promptText.length / CHARS_PER_TOKEN_ESTIMATE)
}

/**
 * Budget held for one attempt: the worst case of every allowed provider
 * request (full output limit each time), so an attempt never starts unless
 * it fits completely.
 */
export function attemptReservation(
  price: ModelPrice,
  promptText: string,
  maxOutputTokens: number,
  maxRetries: number,
): number {
  const perRequest = estimateCost(price, estimateInputTokens(promptText), maxOutputTokens)
  return round6(perRequest * (maxRetries + 1))
}

/** spent + running reservations + this estimate must not exceed the budget. */
export function fitsBudget(input: {
  budget: number | null
  spent: number
  reserved: number
  estimate: number
}): boolean {
  if (input.budget === null) return false
  return round6(input.spent + input.reserved + input.estimate) <= input.budget
}
