/**
 * POST /functions/v1/process-recommendations   (admin only)
 *
 *   { "action": "start", "mode": "PROCESS", "process_all_ready": true }
 *   { "action": "start", "mode": "PROCESS" | "RETRY" | "REPROCESS", "user_ids": [uuid, …] }
 *   { "action": "continue" }   process the next batch of PENDING users
 *
 * The request carries only these commands. Any other field is rejected: the
 * AI input is always built on the server from the database (spec §35;
 * Prompt 10 §69–70).
 *
 * Flow: authenticate the JWT → require an active ADMIN/SUPER_ADMIN → load the
 * operational config (enabled, budget, provider, prompt, pricing) → mark
 * stale PROCESSING attempts failed → queue (start) → process one batch
 * within a time budget → refresh run statuses. Remaining users stay PENDING
 * for the next "continue" call. See docs/recommendations.md.
 *
 * Never logged: the request body, tokens, keys, user text or AI input.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  parseOperationalConfig,
  SETTING_KEYS,
} from '../../../src/features/recommendations/engine/config.ts'
import { priceFor } from '../../../src/features/recommendations/engine/cost.ts'
import { processBatch } from '../../../src/features/recommendations/engine/processor.ts'
import { PROMPTS } from '../../../src/features/recommendations/engine/prompts.ts'
import type { Database } from '../../../src/types/database.ts'
import { createProvider, resolveProvider } from './providers.ts'
import { SupabaseProcessingRepository } from './repository.ts'

type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'AI_DISABLED'
  | 'BUDGET_NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PRICING_NOT_CONFIGURED'
  | 'PROMPT_NOT_FOUND'
  | 'SERVER_ERROR'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ALLOWED_ORIGINS = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/** Stop starting new users after this long, well inside the runtime's wall-clock limit. */
const TIME_BUDGET_MS = 100_000

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const

const requestSchema = z.union([
  z.strictObject({
    action: z.literal('start'),
    mode: z.literal('PROCESS'),
    process_all_ready: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('start'),
    mode: z.enum(['PROCESS', 'RETRY', 'REPROCESS']),
    user_ids: z.array(z.uuid()).min(1).max(500),
  }),
  z.strictObject({ action: z.literal('continue') }),
])

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function fail(code: ErrorCode, status: number, origin: string | null): Response {
  return json({ error: code }, status, origin)
}

function log(event: string, details: Record<string, string | number>) {
  console.log(JSON.stringify({ fn: 'process-recommendations', event, ...details }))
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, origin)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('process-recommendations: missing server configuration')
    return fail('SERVER_ERROR', 500, origin)
  }

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Who is calling? The JWT is verified by the Auth server.
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return fail('UNAUTHENTICATED', 401, origin)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return fail('UNAUTHENTICATED', 401, origin)
  const adminId = auth.user.id

  // 2. Only active ADMIN / SUPER_ADMIN (never managers, group leaders or users).
  const [roles, profile] = await Promise.all([
    db
      .from('user_roles')
      .select('role')
      .eq('user_id', adminId)
      .in('role', [...ADMIN_ROLES]),
    db.from('profiles').select('is_active').eq('id', adminId).maybeSingle(),
  ])
  if (roles.error || profile.error) {
    console.error('process-recommendations: authorization lookup failed')
    return fail('SERVER_ERROR', 500, origin)
  }
  if (roles.data.length === 0 || !profile.data?.is_active) return fail('FORBIDDEN', 403, origin)

  // 3. Commands only — never AI input.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 400, origin)
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return fail('INVALID_INPUT', 400, origin)
  const command = parsed.data

  try {
    // 4. Operational configuration (server-side; the browser has no say).
    const settings = await db
      .from('system_settings')
      .select('key, value_json')
      .in('key', [...SETTING_KEYS])
    if (settings.error) throw new Error('settings')
    const config = parseOperationalConfig(settings.data)
    if (!config.enabled) return fail('AI_DISABLED', 409, origin)
    if (config.budget === null) return fail('BUDGET_NOT_CONFIGURED', 409, origin)
    const selected = resolveProvider(config, Deno.env)
    const provider = selected ? createProvider(selected, Deno.env) : null
    if (!provider) return fail('PROVIDER_NOT_CONFIGURED', 409, origin)
    if (!(config.promptVersion in PROMPTS)) return fail('PROMPT_NOT_FOUND', 409, origin)
    const pricing = config.pricing
    if (!pricing || pricing.currency !== config.currency || !priceFor(pricing, provider.model)) {
      return fail('PRICING_NOT_CONFIGURED', 409, origin)
    }

    const repository = new SupabaseProcessingRepository(db)
    const recovered = await repository.recoverStale(config.staleMinutes)
    if (recovered > 0) log('stale_recovered', { count: recovered })

    // 5. Queue (start) and pick this call's batch.
    let enqueued: { run_id: string; queued: number; skipped: number; ignored: number } | null = null
    if (command.action === 'start') {
      enqueued = await repository.enqueue({
        mode: command.mode,
        userIds: 'user_ids' in command ? command.user_ids : null,
        allReady: 'process_all_ready' in command,
        createdBy: adminId,
        provider: provider.name,
        model: provider.model,
        promptVersion: config.promptVersion,
        batchSize: config.batchSize,
        budgetLimit: config.budget,
        currency: config.currency,
      })
      log('run_started', {
        run: enqueued.run_id,
        queued: enqueued.queued,
        skipped: enqueued.skipped,
      })
    }
    const attempts = await repository.nextPending(config.batchSize, enqueued?.run_id)

    // 6. Process independently; the budget is enforced per claim in the database.
    const batch = await processBatch(
      attempts,
      {
        repository,
        provider,
        config: {
          promptVersion: config.promptVersion,
          maxOutputTokens: config.maxOutputTokens,
          timeoutSeconds: config.timeoutSeconds,
          maxRetries: config.maxRetries,
          pricing,
        },
        log,
      },
      { deadline: Date.now() + TIME_BUDGET_MS },
    )

    const runIds = new Set(attempts.map((attempt) => attempt.runId))
    if (enqueued) runIds.add(enqueued.run_id)
    const runs: Record<string, string> = {}
    for (const runId of runIds) {
      runs[runId] = await repository.refreshRun(runId, batch.stoppedByBudget)
    }
    const pending = await repository.pendingCount()
    log('batch_done', {
      success: batch.success,
      failed: batch.failed,
      skipped: batch.skipped,
      errors: batch.errors,
      pending,
    })

    return json(
      {
        run_id: enqueued?.run_id ?? null,
        queued: enqueued?.queued ?? 0,
        skipped_at_queue: enqueued?.skipped ?? 0,
        ignored: enqueued?.ignored ?? 0,
        batch: {
          processed: batch.processed,
          success: batch.success,
          failed: batch.failed,
          skipped: batch.skipped,
          errors: batch.errors,
          stopped_by_budget: batch.stoppedByBudget,
          stopped_by_time: batch.stoppedByTime,
        },
        runs,
        pending,
      },
      200,
      origin,
    )
  } catch (error) {
    console.error(
      'process-recommendations: processing error',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    )
    return fail('SERVER_ERROR', 500, origin)
  }
})
