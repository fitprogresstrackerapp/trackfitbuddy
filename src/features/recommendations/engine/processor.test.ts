import { describe, expect, it, vi } from 'vitest'

import type { InputSource } from './input-builder'
import type { RecommendationOutput } from './output'
import {
  processAttempt,
  processBatch,
  type ClaimRequest,
  type PendingAttempt,
  type ProcessingRepository,
  type ProcessorConfig,
  type UsageEntry,
} from './processor'
import {
  MockRecommendationProvider,
  ProviderError,
  type AIRecommendationProvider,
} from './provider'

const CONFIG: ProcessorConfig = {
  promptVersion: 'recommendation-v1',
  maxOutputTokens: 1000,
  timeoutSeconds: 5,
  maxRetries: 1,
  pricing: {
    version: 'test',
    currency: 'INR',
    models: { 'mock-recommender-1': { input_per_million: 0, output_per_million: 1_000_000 } },
  },
}

function sourceFor(
  userId: string,
  feedback: string | null = null,
): InputSource & { goalId: string } {
  return {
    processingDate: '2026-10-05',
    profile: {
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      heightCm: 178,
      activityLevel: null,
      job: null,
      hobbies: null,
      workoutDaysPerWeek: userId === 'no-capacity' ? null : 4,
      missingFields: userId === 'incomplete' ? ['height_cm'] : [],
    },
    goal: { id: `goal-${userId}`, longTermGoal: 'GENERAL_FITNESS', description: null, focuses: [] },
    goalId: `goal-${userId}`,
    previousCycle: null,
    cycles: [],
    snapshots: [],
    nutritionDays: [],
    workouts: [],
    activities: [],
    weights: [],
    composition: [],
    steps: [],
    currentWeight: { date: '2026-10-01', weightKg: 80 },
    latestInbody: null,
    feedback,
  }
}

interface Record_ {
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
  reason?: string
  reserved?: number
  usage?: UsageEntry[]
  input?: unknown
  raw?: unknown
  parsed?: RecommendationOutput
}

/**
 * In-memory repository mirroring the database contract: claims are
 * serialised (the budget advisory lock), running reservations count against
 * the budget, and the frozen feedback is written into the stored input.
 */
class FakeRepository implements ProcessingRepository {
  readonly records = new Map<string, Record_>()
  spent = 0
  budget: number | null = 1_000_000
  feedback = new Map<string, string>()
  completeError: Error | null = null
  private lock: Promise<unknown> = Promise.resolve()

  constructor(ids: string[]) {
    for (const id of ids) this.records.set(id, { status: 'PENDING' })
  }

  loadSource(userId: string) {
    return Promise.resolve(sourceFor(userId, this.feedback.get(userId) ?? null))
  }

  claim(request: ClaimRequest) {
    const run = this.lock.then(() => {
      const record = this.records.get(request.attemptId)
      if (record?.status !== 'PENDING') return { result: 'NOT_PENDING' as const }
      if (this.budget === null) return { result: 'BUDGET_NOT_CONFIGURED' as const }
      const reserved = [...this.records.values()].reduce((sum, r) => sum + (r.reserved ?? 0), 0)
      if (this.spent + reserved + request.estimatedCost > this.budget) {
        return { result: 'BUDGET_EXCEEDED' as const }
      }
      const input = {
        ...(request.input as object),
        feedback: this.feedback.get(request.attemptId.replace('attempt-', '')) ?? null,
      }
      Object.assign(record, { status: 'PROCESSING', reserved: request.estimatedCost, input })
      return { result: 'CLAIMED' as const, input }
    })
    this.lock = run
    return run
  }

  skip(attemptId: string, reason: string) {
    this.records.set(attemptId, { status: 'SKIPPED', reason })
    return Promise.resolve()
  }

  private settle(attemptId: string, usage: UsageEntry[]) {
    this.spent += usage.reduce((sum, entry) => sum + (entry.estimated_cost ?? 0), 0)
    const record = this.records.get(attemptId)
    if (record) record.reserved = 0
  }

  fail(attemptId: string, reason: string, raw: unknown, usage: UsageEntry[]) {
    this.settle(attemptId, usage)
    Object.assign(this.records.get(attemptId) ?? {}, { status: 'FAILED', reason, raw, usage })
    return Promise.resolve()
  }

  complete(attemptId: string, raw: unknown, parsed: RecommendationOutput, usage: UsageEntry[]) {
    if (this.completeError) return Promise.reject(this.completeError)
    this.settle(attemptId, usage)
    Object.assign(this.records.get(attemptId) ?? {}, { status: 'SUCCESS', raw, parsed, usage })
    return Promise.resolve(`cycle-${attemptId}`)
  }
}

const attempt = (userId: string): PendingAttempt => ({
  id: `attempt-${userId}`,
  userId,
  runId: 'run',
  mode: 'PROCESS',
})

function setup(userIds: string[], feedback: Record<string, string> = {}) {
  const repository = new FakeRepository(userIds.map((id) => `attempt-${id}`))
  for (const [id, text] of Object.entries(feedback)) repository.feedback.set(id, text)
  const provider = new MockRecommendationProvider()
  return { repository, provider, context: { repository, provider, config: CONFIG } }
}

describe('processAttempt', () => {
  it('success: claims with a reservation, validates, then persists once', async () => {
    const { repository, context } = setup(['asha'], { asha: 'Prefer short sessions.' })
    const claim = vi.spyOn(repository, 'claim')
    expect(await processAttempt(attempt('asha'), context)).toBe('SUCCESS')
    const request = claim.mock.calls[0]?.[0]
    expect(request).toMatchObject({
      provider: 'mock',
      model: 'mock-recommender-1',
      promptVersion: 'recommendation-v1',
      pricingVersion: 'test',
      inputSchemaVersion: 'recommendation-input-v1',
      goalId: 'goal-asha',
      capacity: 4,
      // 1,000 output tokens × 1 INR × (1 + 1 retry)
      estimatedCost: 2000,
    })
    const record = repository.records.get('attempt-asha')
    expect(record?.status).toBe('SUCCESS')
    expect(record?.parsed?.workout_plan.sessions).toHaveLength(4)
    expect(record?.usage).toHaveLength(1)
    expect(record?.usage?.[0]?.succeeded).toBe(true)
    expect(record?.usage?.[0]?.input_tokens).toBeGreaterThan(0)
    expect(record?.reserved).toBe(0)
  })

  it('the AI receives the input as stored at claim time (feedback frozen there)', async () => {
    const { repository, provider, context } = setup(['asha'], { asha: 'Frozen text' })
    const generate = vi.spyOn(provider, 'generateRecommendation')
    await processAttempt(attempt('asha'), context)
    expect(generate.mock.calls[0]?.[0].feedback).toBe('Frozen text')
    expect(repository.records.get('attempt-asha')?.input).toMatchObject({ feedback: 'Frozen text' })
  })

  it('users who are not ready are skipped, never sent to the AI', async () => {
    const { repository, provider, context } = setup(['incomplete'])
    const generate = vi.spyOn(provider, 'generateRecommendation')
    expect(await processAttempt(attempt('incomplete'), context)).toBe('SKIPPED')
    expect(repository.records.get('attempt-incomplete')).toEqual({
      status: 'SKIPPED',
      reason: 'Profile incomplete',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('retryable provider errors are retried (bounded), each request recorded', async () => {
    const { repository, context } = setup(['t'], { t: '[mock:timeout]' })
    expect(await processAttempt(attempt('t'), context)).toBe('FAILED')
    const record = repository.records.get('attempt-t')
    expect(record?.reason).toBe('Provider timeout')
    expect(record?.usage).toHaveLength(2)
    expect(record?.usage?.every((entry) => !entry.succeeded)).toBe(true)
  })

  it('authentication failures are not retried', async () => {
    const { repository, context } = setup(['a'], { a: '[mock:auth]' })
    expect(await processAttempt(attempt('a'), context)).toBe('FAILED')
    expect(repository.records.get('attempt-a')).toMatchObject({
      reason: 'Provider authentication failed',
      usage: [expect.objectContaining({ succeeded: false })],
    })
  })

  it('malformed output is retried once and can then succeed', async () => {
    const { repository, context } = setup(['f'], { f: '[mock:flaky_json]' })
    expect(await processAttempt(attempt('f'), context)).toBe('SUCCESS')
    expect(repository.records.get('attempt-f')?.usage?.map((entry) => entry.succeeded)).toEqual([
      false,
      true,
    ])
  })

  it('invalid business values fail immediately and keep the raw output', async () => {
    const { repository, context } = setup(['r'], { r: '[mock:out_of_range]' })
    expect(await processAttempt(attempt('r'), context)).toBe('FAILED')
    const record = repository.records.get('attempt-r')
    expect(record?.reason).toBe('Target out of range: calories')
    expect(record?.usage).toHaveLength(1)
    const raw = record?.raw as { text: string; validation: { code: string } }
    expect(raw.text).toContain('12000')
    expect(raw.validation.code).toBe('TARGET_OUT_OF_RANGE')
  })

  it('a truncated or refused response is a failure, not a recommendation', async () => {
    const provider: AIRecommendationProvider = {
      name: 'mock',
      model: 'mock-recommender-1',
      generateRecommendation: () =>
        Promise.resolve({
          rawText: '{"assessment":',
          provider: 'mock',
          model: 'mock-recommender-1',
          inputTokens: 10,
          outputTokens: 1000,
          totalTokens: 1010,
          actualCost: null,
          stopReason: 'max_tokens',
          requestId: null,
        }),
    }
    const { repository } = setup(['m'])
    expect(await processAttempt(attempt('m'), { repository, provider, config: CONFIG })).toBe(
      'FAILED',
    )
    expect(repository.records.get('attempt-m')?.reason).toBe('AI output hit the output token limit')
  })

  it('a save conflict (already processed) fails the attempt with a concise reason', async () => {
    const { repository, context } = setup(['d'])
    repository.completeError = new Error('Already has a recommendation this month')
    expect(await processAttempt(attempt('d'), context)).toBe('FAILED')
    expect(repository.records.get('attempt-d')?.reason).toBe(
      'Already has a recommendation this month',
    )
  })

  it('a hung provider call times out', async () => {
    vi.useFakeTimers()
    try {
      const provider: AIRecommendationProvider = {
        name: 'mock',
        model: 'mock-recommender-1',
        generateRecommendation: () => new Promise(() => undefined),
      }
      const { repository } = setup(['h'])
      const pending = processAttempt(attempt('h'), {
        repository,
        provider,
        config: { ...CONFIG, maxRetries: 0 },
      })
      await vi.advanceTimersByTimeAsync(11_000)
      expect(await pending).toBe('FAILED')
      expect(repository.records.get('attempt-h')?.reason).toBe('Provider timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('without budget the attempt is not claimed', async () => {
    const { repository, context } = setup(['b'])
    repository.budget = null
    expect(await processAttempt(attempt('b'), context)).toBe('BUDGET')
    expect(repository.records.get('attempt-b')?.status).toBe('PENDING')
  })
})

describe('processBatch', () => {
  it('isolates failures: 12 successful, 3 failed', async () => {
    const ids = Array.from({ length: 15 }, (_, index) => `u${String(index)}`)
    const failing = { u1: '[mock:unavailable]', u3: '[mock:schema_invalid]', u7: '[mock:weekday]' }
    const { repository, context } = setup(ids, failing)
    const result = await processBatch(ids.map(attempt), context)
    expect(result).toMatchObject({ success: 12, failed: 3, stoppedByBudget: false })
    expect(repository.records.get('attempt-u3')?.status).toBe('FAILED')
  })

  it('an unexpected error for one user never stops the others', async () => {
    const { repository, context } = setup(['ok1', 'boom', 'ok2'])
    const load = repository.loadSource.bind(repository)
    vi.spyOn(repository, 'loadSource').mockImplementation((userId: string) =>
      userId === 'boom' ? Promise.reject(new Error('db down')) : load(userId),
    )
    const result = await processBatch(['ok1', 'boom', 'ok2'].map(attempt), context)
    expect(result).toMatchObject({ success: 2, errors: 1 })
    expect(repository.records.get('attempt-boom')?.status).toBe('PENDING')
  })

  it('stops at the budget: remaining users stay PENDING (concurrent claims)', async () => {
    const ids = ['a', 'b', 'c', 'd']
    const { repository, context } = setup(ids)
    // Each attempt reserves 2,000; exactly one fits.
    repository.budget = 2000
    const result = await processBatch(ids.map(attempt), context, { concurrency: 4 })
    expect(result).toMatchObject({ success: 1, stoppedByBudget: true })
    const statuses = [...repository.records.values()].map((record) => record.status).sort()
    expect(statuses).toEqual(['PENDING', 'PENDING', 'PENDING', 'SUCCESS'])
    expect(repository.spent).toBeLessThanOrEqual(2000)
  })

  it('exactly at budget is allowed; one unit over is not', async () => {
    const { repository, context } = setup(['a'])
    repository.budget = 1999.99
    expect((await processBatch([attempt('a')], context)).stoppedByBudget).toBe(true)
    repository.budget = 2000
    expect((await processBatch([attempt('a')], context)).success).toBe(1)
  })

  it('stops starting new users after the time budget; they stay PENDING', async () => {
    const ids = ['a', 'b', 'c']
    const { repository, context } = setup(ids)
    let clock = 0
    const now = () => clock
    const load = repository.loadSource.bind(repository)
    vi.spyOn(repository, 'loadSource').mockImplementation((userId: string) => {
      clock += 60
      return load(userId)
    })
    const result = await processBatch(ids.map(attempt), context, {
      concurrency: 1,
      deadline: 100,
      now,
    })
    expect(result).toMatchObject({ success: 2, stoppedByTime: true })
    expect(repository.records.get('attempt-c')?.status).toBe('PENDING')
  })

  it('provider errors carry no secrets into stored reasons', async () => {
    const provider: AIRecommendationProvider = {
      name: 'mock',
      model: 'mock-recommender-1',
      generateRecommendation: () => Promise.reject(new Error('401 invalid x-api-key sk-ant-123')),
    }
    const { repository } = setup(['s'])
    await processAttempt(attempt('s'), { repository, provider, config: CONFIG })
    const record = repository.records.get('attempt-s')
    expect(record?.reason).toBe('Provider error')
    expect(JSON.stringify(record)).not.toContain('sk-ant')
    expect(new ProviderError('unknown').message).toBe('Provider error')
  })
})
