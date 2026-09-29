import { FunctionsHttpError } from '@supabase/supabase-js'

import type { AppSupabaseClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

/*
 * Admin recommendation processing (spec §42; Prompt 10 §44–49, §107).
 *
 * Reads go through admin-only SQL functions and RLS (processing tables are
 * admin-only). Processing goes through the process-recommendations Edge
 * Function. The browser sends only a command (user ids or
 * process_all_ready), never AI input, budget or configuration. The function
 * re-checks the admin role server-side.
 */

export type ProcessingState =
  'READY' | 'INCOMPLETE' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'

export const PROCESSING_STATES: readonly ProcessingState[] = [
  'READY',
  'INCOMPLETE',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
]

type OverviewRow = Database['public']['Functions']['recommendation_overview']['Returns'][number]

export interface OverviewUser {
  userId: string
  name: string | null
  localDate: string
  processingMonth: string
  missingFields: string[]
  hasGoal: boolean
  capacity: number | null
  lastRecommendation: string | null
  latestAttemptAt: string | null
  failureReason: string | null
  skipReason: string | null
  state: ProcessingState
}

function toState(value: string): ProcessingState {
  return (PROCESSING_STATES as readonly string[]).includes(value)
    ? (value as ProcessingState)
    : 'INCOMPLETE'
}

function toOverviewUser(row: OverviewRow): OverviewUser {
  return {
    userId: row.user_id,
    name: row.name,
    localDate: row.local_date,
    processingMonth: row.processing_month,
    missingFields: row.missing_fields,
    hasGoal: row.has_goal,
    capacity: row.workout_days_per_week,
    lastRecommendation: row.last_cycle_start,
    latestAttemptAt: row.latest_attempt_at,
    failureReason: row.latest_failure_reason,
    skipReason: row.latest_skip_reason,
    state: toState(row.state),
  }
}

export async function fetchOverview(supabase: AppSupabaseClient): Promise<OverviewUser[]> {
  const { data, error } = await supabase.rpc('recommendation_overview')
  if (error) throw error
  return data.map(toOverviewUser)
}

export interface AiUsage {
  month: string
  budget: number | null
  currency: string
  estimatedSpend: number
  actualSpend: number | null
  reserved: number
  remaining: number | null
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  usersProcessed: number
  models: string[]
}

export async function fetchUsage(supabase: AppSupabaseClient, month: string): Promise<AiUsage> {
  const { data, error } = await supabase.rpc('ai_usage_summary', { p_month: month }).single()
  if (error) throw error
  return {
    month: data.processing_month,
    budget: data.budget,
    currency: data.currency,
    estimatedSpend: data.estimated_spend,
    actualSpend: data.actual_spend,
    reserved: data.reserved,
    remaining: data.remaining,
    requests: data.requests,
    inputTokens: data.input_tokens,
    outputTokens: data.output_tokens,
    totalTokens: data.total_tokens,
    usersProcessed: data.users_processed,
    models: data.models,
  }
}

type AttemptStatus = Database['public']['Enums']['processing_user_status']

export interface AttemptRecord {
  id: string
  userId: string
  userName: string | null
  mode: string
  attempt: number
  status: AttemptStatus
  reason: string | null
  provider: string | null
  model: string | null
  promptVersion: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  actualCost: number | null
  currency: string
  createdAt: string
  generatedAt: string | null
}

export const HISTORY_PAGE_SIZE = 20

/** Every attempt, newest first (history is never deleted). No AI input or output is read. */
export async function fetchHistory(
  supabase: AppSupabaseClient,
  page: number,
): Promise<{ rows: AttemptRecord[]; total: number }> {
  const from = page * HISTORY_PAGE_SIZE
  const { data, error, count } = await supabase
    .from('recommendation_processing_users')
    .select(
      'id, user_id, attempt_number, status, skip_reason, failure_reason, provider, model, prompt_version, input_tokens, output_tokens, total_tokens, estimated_cost, actual_cost, currency, created_at, generated_at, profiles(name), recommendation_processing_runs(mode)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, from + HISTORY_PAGE_SIZE - 1)
  if (error) throw error
  return {
    total: count ?? 0,
    rows: data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.profiles.name,
      mode: row.recommendation_processing_runs.mode,
      attempt: row.attempt_number,
      status: row.status,
      reason: row.failure_reason ?? row.skip_reason,
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.status === 'PENDING' ? null : row.total_tokens,
      estimatedCost: row.estimated_cost,
      actualCost: row.actual_cost,
      currency: row.currency,
      createdAt: row.created_at,
      generatedAt: row.generated_at,
    })),
  }
}

export type ProcessingCommand =
  | { action: 'start'; mode: 'PROCESS'; process_all_ready: true }
  | { action: 'start'; mode: 'PROCESS' | 'RETRY' | 'REPROCESS'; user_ids: string[] }
  | { action: 'continue' }

export interface ProcessingResult {
  run_id: string | null
  queued: number
  skipped_at_queue: number
  ignored: number
  batch: {
    processed: number
    success: number
    failed: number
    skipped: number
    errors: number
    stopped_by_budget: boolean
    stopped_by_time: boolean
  }
  runs: Record<string, string>
  pending: number
}

export class ProcessingError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'ProcessingError'
    this.code = code
  }
}

export async function runProcessing(
  supabase: AppSupabaseClient,
  command: ProcessingCommand,
): Promise<ProcessingResult> {
  const response = await supabase.functions.invoke<ProcessingResult>('process-recommendations', {
    body: command,
  })
  const error: unknown = response.error
  const data = response.data
  if (error) {
    let code = 'SERVER_ERROR'
    if (error instanceof FunctionsHttpError) {
      try {
        const body: unknown = await (error.context as Response).json()
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
          code = body.error
        }
      } catch {
        // keep the generic code
      }
    }
    throw new ProcessingError(code)
  }
  if (!data) throw new ProcessingError('SERVER_ERROR')
  return data
}

const PROCESSING_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Only admins can process recommendations.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again.',
  AI_DISABLED: 'AI processing is turned off in the settings.',
  BUDGET_NOT_CONFIGURED: 'Set a monthly AI budget before processing.',
  PROVIDER_NOT_CONFIGURED: 'The AI provider is not configured on the server.',
  PRICING_NOT_CONFIGURED: 'Model pricing is missing or uses a different currency than the budget.',
  PROMPT_NOT_FOUND: 'The configured prompt version does not exist.',
  INVALID_INPUT: 'The request was not valid.',
}

export function processingErrorMessage(error: unknown): string {
  const code = error instanceof ProcessingError ? error.code : ''
  return PROCESSING_ERROR_MESSAGES[code] ?? 'Processing could not run. Please try again.'
}
