/**
 * Monthly AI recommendation engine against the real local stack: the
 * process-recommendations Edge Function (mock AI provider), the processing
 * SQL functions, RLS, feedback locking, cycles, snapshots, budget and
 * history. Users act through the app's own data functions (RLS applies).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fetchPlan, reviewRecommendation } from '@/features/profile/api/profile-data'
import { fetchNutritionPeriod, fetchTrainingPeriod } from '@/features/progress/api/progress-data'
import {
  datesIn,
  nutritionSeries,
  summarizeNutrition,
  targetsByDate,
  weeklyTraining,
  workoutAdherence,
} from '@/features/progress/lib/progress-logic'
import { fetchHistory, fetchOverview, fetchUsage } from '@/features/recommendations/api/admin-data'
import {
  fetchMonthlyFeedback,
  fetchRecommendationHistory,
  saveMonthlyFeedback,
} from '@/features/recommendations/api/recommendation-data'
import type { RecommendationInput } from '@/features/recommendations/engine/input'
import { addDays, calendarWeekOf } from '@/lib/dates/local-date'
import type { Json } from '@/types/database'

import { seedFoods, seedPastMeal } from './food-fixtures.ts'
import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { must, run, TODAY } from './home-fixtures.ts'
import { seedInbody } from './profile-fixtures.ts'
import {
  attemptsFor,
  callProcessing,
  cyclesFor,
  drainPending,
  getSetting,
  makeReady,
  MONTH,
  PREVIOUS_MONTH,
  PREVIOUS_START,
  PREVIOUS_TARGETS,
  seedPreviousCycle,
  setSetting,
} from './recommendation-fixtures.ts'
import { seedLockedWorkout } from './training-fixtures.ts'

interface User {
  userId: string
  phone: string
  pin: string
}

const SAVED_KEYS = ['ai_monthly_budget', 'ai_pricing', 'ai_max_retries', 'ai_max_output_tokens']

function input(attempt: { raw_input_json: Json }): RecommendationInput {
  return attempt.raw_input_json as unknown as RecommendationInput
}

describe('Recommendation engine', () => {
  const admin = adminClient()
  const saved = new Map<string, Json | undefined>()
  let adminUser: User
  let adminSession: BrowserClient
  let managerClient: BrowserClient
  let plainClient: BrowserClient
  let first: User
  let firstClient: BrowserClient
  let firstGoal: string
  let second: User
  let secondClient: BrowserClient
  let secondGoalA: string
  let secondGoalB: string
  let secondPreviousCycle: string
  let incomplete: User

  beforeAll(async () => {
    for (const key of SAVED_KEYS) saved.set(key, await getSetting(admin, key))
    await setSetting(admin, 'ai_monthly_budget', 100000)

    adminUser = await createUser('1234', ['ADMIN'])
    const manager = await createUser('1234', ['MANAGER'])
    const plain = await createUser('1234')
    first = await createUser('1234')
    second = await createUser('1234')
    incomplete = await createUser('1234')

    firstGoal = await makeReady(admin, first.userId, { capacity: 4 })
    // Second: previous cycle judged at 3 days with goal A; since then the user
    // switched to goal B and 5 days (both apply to the NEXT cycle).
    secondGoalA = await makeReady(admin, second.userId, {
      capacity: 5,
      goal: 'FAT_LOSS',
      effectiveFrom: PREVIOUS_START,
    })
    secondPreviousCycle = await seedPreviousCycle(admin, second.userId, secondGoalA, 3)
    await run(
      admin.from('goals').update({ is_active: false, effective_to: TODAY }).eq('id', secondGoalA),
    )
    secondGoalB = (
      await must(
        admin
          .from('goals')
          .insert({ user_id: second.userId, long_term_goal: 'MUSCLE_GAIN', effective_from: TODAY })
          .select('id')
          .single(),
      )
    ).id
    const foods = await seedFoods(admin)
    for (const offset of [2, 3, 9]) {
      await seedPastMeal(admin, second.userId, addDays(PREVIOUS_START, offset), foods.idli.id, 6)
    }
    const fullWeek = calendarWeekOf(addDays(PREVIOUS_START, 7)).start
    await seedLockedWorkout(admin, second.userId, fullWeek, 'UPPER_BODY')
    await seedLockedWorkout(admin, second.userId, addDays(fullWeek, 2), 'LEGS')
    await seedInbody(admin, second.userId, addDays(PREVIOUS_START, 5), {
      weight: 70.4,
      fat: 21.5,
      muscle: 31.2,
    })

    // Incomplete: no height, no goal.
    await run(admin.from('profiles').update({ name: 'Incomplete' }).eq('id', incomplete.userId))

    await run(
      admin
        .from('manager_user_assignments')
        .insert({ manager_id: manager.userId, user_id: second.userId }),
    )

    adminSession = await signedInClient(adminUser.phone, adminUser.pin)
    managerClient = await signedInClient(manager.phone, manager.pin)
    plainClient = await signedInClient(plain.phone, plain.pin)
    firstClient = await signedInClient(first.phone, first.pin)
    secondClient = await signedInClient(second.phone, second.pin)
  })

  afterAll(async () => {
    for (const [key, value] of saved) await setSetting(admin, key, value)
  })

  describe('authorization', () => {
    it('rejects anonymous callers, users and managers (server-side)', async () => {
      const body = { action: 'start', mode: 'PROCESS', user_ids: [first.userId] }
      expect((await callProcessing(null, body)).status).toBe(401)
      expect(await callProcessing(plainClient, body)).toMatchObject({
        status: 403,
        body: { error: 'FORBIDDEN' },
      })
      expect(await callProcessing(managerClient, body)).toMatchObject({
        status: 403,
        body: { error: 'FORBIDDEN' },
      })
      expect(await attemptsFor(admin, first.userId)).toHaveLength(0)
    })

    it('accepts only commands, never client-supplied AI input', async () => {
      for (const body of [
        { action: 'start', mode: 'PROCESS', user_ids: [first.userId], input: { weight_kg: 50 } },
        { action: 'start', mode: 'PROCESS', process_all_ready: true, previous_completion: '100%' },
        { action: 'start', mode: 'RETRY', process_all_ready: true },
        { action: 'start', mode: 'PROCESS', user_ids: ['not-a-uuid'] },
        { action: 'start', mode: 'PROCESS', user_ids: [first.userId], budget: 1e9 },
      ]) {
        expect(await callProcessing(adminSession, body)).toMatchObject({
          status: 400,
          body: { error: 'INVALID_INPUT' },
        })
      }
      expect(await attemptsFor(admin, first.userId)).toHaveLength(0)
    })

    it('processing functions are service-role only, even for admins', async () => {
      const claim = await adminSession.rpc('claim_recommendation_attempt', {
        p_attempt_id: first.userId,
        p_input: {},
        p_estimated_cost: 0,
        p_provider: 'mock',
        p_model: 'mock-recommender-1',
        p_prompt_version: 'recommendation-v1',
        p_pricing_version: 'x',
        p_input_schema_version: 'x',
        p_goal_id: firstGoal,
        p_capacity: 4,
      })
      expect(claim.error?.code).toBe('42501')
      const complete = await plainClient.rpc('complete_recommendation_attempt', {
        p_attempt_id: first.userId,
        p_raw_output: {},
        p_parsed: {},
        p_usage: [],
      })
      expect(complete.error?.code).toBe('42501')
      const nutrition = await plainClient.rpc('recommendation_daily_nutrition', {
        p_user_id: second.userId,
        p_start: PREVIOUS_START,
        p_end: TODAY,
      })
      expect(nutrition.error?.code).toBe('42501')
    })

    it('the processing overview is admin-only and explains readiness', async () => {
      await expect(fetchOverview(plainClient)).rejects.toMatchObject({ code: '42501' })
      await expect(fetchOverview(managerClient)).rejects.toMatchObject({ code: '42501' })
      const overview = await fetchOverview(adminSession)
      const byId = new Map(overview.map((user) => [user.userId, user]))
      expect(byId.get(first.userId)).toMatchObject({ state: 'READY', hasGoal: true, capacity: 4 })
      expect(byId.get(incomplete.userId)).toMatchObject({ state: 'INCOMPLETE', hasGoal: false })
      expect(byId.get(incomplete.userId)?.missingFields).toEqual(
        expect.arrayContaining(['height_cm', 'current_weight']),
      )
    })
  })

  describe('monthly feedback', () => {
    it('the user saves and updates this month’s check-in; nobody else can', async () => {
      await saveMonthlyFeedback(firstClient, first.userId, MONTH, 'The split felt hard.')
      await saveMonthlyFeedback(
        firstClient,
        first.userId,
        MONTH,
        'The split felt hard. I would prefer more variety.',
      )
      expect(await fetchMonthlyFeedback(firstClient, first.userId, TODAY)).toMatchObject({
        month: MONTH,
        feedback: 'The split felt hard. I would prefer more variety.',
        locked: false,
        processed: false,
      })

      const peek = await plainClient
        .from('recommendation_feedback')
        .select('feedback')
        .eq('user_id', first.userId)
      expect(peek.data).toEqual([])
      const tamper = await plainClient
        .from('recommendation_feedback')
        .update({ feedback: 'hijacked' })
        .eq('user_id', first.userId)
        .select('id')
      expect(tamper.data ?? []).toEqual([])
      const forge = await plainClient
        .from('recommendation_feedback')
        .insert({ user_id: first.userId, feedback_month: MONTH, feedback: 'forged' })
      expect(forge.error).not.toBeNull()
      await expect(
        saveMonthlyFeedback(firstClient, first.userId, PREVIOUS_MONTH, 'Too late'),
      ).rejects.toBeTruthy()
    })
  })

  describe('processing', () => {
    it('first recommendation: a ready user is processed, an incomplete one is skipped', async () => {
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'PROCESS',
        user_ids: [first.userId, incomplete.userId],
      })
      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ queued: 1, skipped_at_queue: 1 })
      expect(response.body.batch).toMatchObject({ success: 1, failed: 0 })

      const [attempt] = await attemptsFor(admin, first.userId)
      expect(attempt).toMatchObject({
        status: 'SUCCESS',
        provider: 'mock',
        model: 'mock-recommender-1',
        prompt_version: 'recommendation-v1',
        goal_id: firstGoal,
        workout_days_per_week: 4,
        reserved_cost: null,
        processing_month: MONTH,
      })
      expect(attempt?.pricing_version).toBeTruthy()
      expect(attempt?.input_tokens).toBeGreaterThan(0)
      expect(attempt?.estimated_cost).toBeGreaterThan(0)
      const firstInput = input(attempt as { raw_input_json: Json })
      expect(firstInput).toMatchObject({
        schema_version: 'recommendation-input-v1',
        processing_date: TODAY,
        first_recommendation: true,
        previous_cycle: null,
        previous_recommendation: null,
        inbody: null,
        feedback: 'The split felt hard. I would prefer more variety.',
        workout: { days_per_week: 4 },
        goals: { long_term: 'fat_loss', short_term: ['muscle_building', 'general_fitness'] },
      })
      expect(firstInput.recent_data?.end).toBe(addDays(TODAY, -1))
      expect(firstInput.user.current_weight_kg).toBe(61.5)

      const [skipped] = await attemptsFor(admin, incomplete.userId)
      expect(skipped).toMatchObject({ status: 'SKIPPED', skip_reason: 'Profile incomplete' })

      const cycles = await cyclesFor(admin, first.userId)
      expect(cycles).toHaveLength(1)
      const cycle = cycles[0]
      expect(cycle).toMatchObject({
        status: 'IN_REVIEW',
        processing_month: MONTH,
        period_start: TODAY,
        period_end: null,
        review_deadline: addDays(TODAY, 1),
        goal_id: firstGoal,
        workout_days_per_week: 4,
        previous_cycle_id: null,
        processing_user_id: attempt?.id,
        provider: 'mock',
        prompt_version: 'recommendation-v1',
      })
      expect(cycle?.final_calories).toBe(cycle?.recommended_calories)
      expect((cycle?.workout_plan_json as { sessions: unknown[] }).sessions).toHaveLength(4)

      const snapshots = await must(
        admin
          .from('daily_target_snapshots')
          .select('target_date, calories, recommendation_cycle_id, workouts_per_week')
          .eq('user_id', first.userId)
          .order('target_date'),
      )
      expect(snapshots).toHaveLength(62)
      expect(snapshots[0]).toMatchObject({
        target_date: TODAY,
        calories: cycle?.final_calories,
        recommendation_cycle_id: cycle?.id,
        workouts_per_week: 4,
      })

      const usage = await must(
        admin
          .from('ai_usage_records')
          .select('succeeded, model')
          .eq('processing_user_id', attempt?.id ?? ''),
      )
      expect(usage).toEqual([{ succeeded: true, model: 'mock-recommender-1' }])
    })

    it('feedback is locked and linked once the recommendation is generated', async () => {
      expect(await fetchMonthlyFeedback(firstClient, first.userId, TODAY)).toMatchObject({
        locked: true,
        processed: true,
      })
      await expect(
        saveMonthlyFeedback(firstClient, first.userId, MONTH, 'Changed my mind'),
      ).rejects.toBeTruthy()
      const [cycle] = await cyclesFor(admin, first.userId)
      const row = await must(
        admin
          .from('recommendation_feedback')
          .select('feedback, recommendation_cycle_id, locked_at')
          .eq('user_id', first.userId)
          .single(),
      )
      expect(row.feedback).toBe('The split felt hard. I would prefer more variety.')
      expect(row.recommendation_cycle_id).toBe(cycle?.id)
      expect(row.locked_at).not.toBeNull()
    })

    it('the user reviews it with the existing review flow', async () => {
      const plan = await fetchPlan(firstClient, first.userId, TODAY)
      expect(plan.recommendation).toMatchObject({ status: 'IN_REVIEW', periodStart: TODAY })
      expect(plan.recommendation?.sessions).toHaveLength(4)
      expect(plan.recommendation?.summary).toBeTruthy()
      const recommendation = plan.recommendation
      if (!recommendation) throw new Error('missing')
      await reviewRecommendation(firstClient, recommendation.id, {
        calories: recommendation.recommended.calories + 100,
        proteinG: recommendation.recommended.proteinG,
        carbsG: recommendation.recommended.carbsG,
        fatG: recommendation.recommended.fatG,
        fiberG: recommendation.recommended.fiberG,
        sessions: recommendation.sessions,
      })
      expect(await fetchRecommendationHistory(firstClient, first.userId)).toEqual([
        expect.objectContaining({ id: recommendation.id, status: 'IN_REVIEW', periodStart: TODAY }),
      ])
    })

    it('successful users are not processed again by PROCESS or RETRY', async () => {
      for (const mode of ['PROCESS', 'RETRY']) {
        const response = await callProcessing(adminSession, {
          action: 'start',
          mode,
          user_ids: [first.userId],
        })
        expect(response.body).toMatchObject({ queued: 0, skipped_at_queue: 1 })
      }
      const attempts = await attemptsFor(admin, first.userId)
      expect(attempts.map((a) => a.status)).toEqual(['SUCCESS', 'SKIPPED', 'SKIPPED'])
      expect(attempts[1]?.skip_reason).toBe('Already has a recommendation this month')
      expect(await cyclesFor(admin, first.userId)).toHaveLength(1)
    })

    it('second recommendation: previous cycle, new goal and capacity, same numbers as Progress', async () => {
      // What Progress shows for the previous cycle, through the app's own data layer.
      const period = { start: PREVIOUS_START, end: addDays(TODAY, -1) }
      const nutrition = await fetchNutritionPeriod(secondClient, second.userId, period)
      const nutritionTargets = targetsByDate(datesIn(period), nutrition.snapshots, nutrition.cycles)
      const progressNutrition = summarizeNutrition(
        nutritionSeries(period, nutrition.days, nutritionTargets),
        nutritionTargets,
        TODAY,
      )
      const training = await fetchTrainingPeriod(secondClient, second.userId, period)
      const trainingTargets = targetsByDate(
        datesIn({ start: training.fetched.start, end: TODAY }),
        training.snapshots,
        training.cycles,
      )
      const progressWorkouts = workoutAdherence(
        weeklyTraining(period, training.workouts, trainingTargets, training.cycles, TODAY),
      )

      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'PROCESS',
        user_ids: [second.userId],
      })
      expect(response.body.batch).toMatchObject({ success: 1 })

      const [attempt] = await attemptsFor(admin, second.userId).then((rows) =>
        rows.filter((row) => row.processing_month === MONTH),
      )
      const secondInput = input(attempt as { raw_input_json: Json })
      expect(secondInput).toMatchObject({
        first_recommendation: false,
        recent_data: null,
        workout: { days_per_week: 5 },
        goals: { long_term: 'muscle_gain', short_term: [] },
        previous_cycle: { workout_days_per_week: 3 },
        previous_recommendation: {
          generated_on: PREVIOUS_START,
          targets: {
            calories: PREVIOUS_TARGETS.calories,
            protein_g: PREVIOUS_TARGETS.protein,
          },
          edited_by_user: true,
          summary: 'Previous plan summary.',
          focus: ['GENERAL_FITNESS'],
        },
        inbody: { weight_kg: 70.4, body_fat_percent: 21.5, muscle_mass_kg: 31.2 },
      })
      expect(secondInput.previous_recommendation?.workout_template).toHaveLength(3)

      const summary = secondInput.previous_cycle?.summary
      expect(summary).toMatchObject({ start: PREVIOUS_START, end: addDays(TODAY, -1) })
      expect(summary?.nutrition.tracked_days).toBe(progressNutrition.trackedDays)
      expect(summary?.nutrition.tracked_days).toBe(3)
      expect(summary?.nutrition.calories.days_met).toBe(
        progressNutrition.nutrients.calories.adherence.met,
      )
      expect(summary?.nutrition.calories.eligible_days).toBe(
        progressNutrition.nutrients.calories.adherence.eligible,
      )
      expect(summary?.nutrition.protein_g.days_met).toBe(
        progressNutrition.nutrients.proteinG.adherence.met,
      )
      expect(summary?.workouts.days_completed).toBe(progressWorkouts.done)
      expect(summary?.workouts.days_expected).toBe(progressWorkouts.expected)
      expect(summary?.workouts.workout_days).toBe(2)

      const cycles = await cyclesFor(admin, second.userId)
      const previous = cycles.find((cycle) => cycle.id === secondPreviousCycle)
      const next = cycles.find((cycle) => cycle.id !== secondPreviousCycle)
      expect(previous).toMatchObject({
        status: 'LOCKED',
        period_start: PREVIOUS_START,
        period_end: addDays(TODAY, -1),
        goal_id: secondGoalA,
        workout_days_per_week: 3,
        final_calories: PREVIOUS_TARGETS.calories,
      })
      expect(next).toMatchObject({
        status: 'IN_REVIEW',
        period_start: TODAY,
        goal_id: secondGoalB,
        workout_days_per_week: 5,
        previous_cycle_id: secondPreviousCycle,
      })

      const around = await must(
        admin
          .from('daily_target_snapshots')
          .select('target_date, calories, workouts_per_week, recommendation_cycle_id')
          .eq('user_id', second.userId)
          .in('target_date', [addDays(TODAY, -1), TODAY]),
      )
      const yesterday = around.find((row) => row.target_date === addDays(TODAY, -1))
      const today = around.find((row) => row.target_date === TODAY)
      expect(yesterday).toMatchObject({
        calories: PREVIOUS_TARGETS.calories,
        workouts_per_week: 3,
        recommendation_cycle_id: secondPreviousCycle,
      })
      expect(today).toMatchObject({
        calories: next?.final_calories,
        workouts_per_week: 5,
        recommendation_cycle_id: next?.id,
      })
    })

    it('an assigned manager sees the recommendation but never the AI input', async () => {
      const cycles = await managerClient
        .from('recommendation_cycles')
        .select('id')
        .eq('user_id', second.userId)
      expect(cycles.data).toHaveLength(2)
      const attempts = await managerClient
        .from('recommendation_processing_users')
        .select('raw_input_json')
        .eq('user_id', second.userId)
      expect(attempts.data).toEqual([])
      const own = await secondClient
        .from('recommendation_processing_users')
        .select('raw_input_json')
        .eq('user_id', second.userId)
      expect(own.data).toEqual([])
      const unrelated = await managerClient
        .from('recommendation_cycles')
        .select('id')
        .eq('user_id', first.userId)
      expect(unrelated.data).toEqual([])
    })
  })

  describe('failures, retry and reprocess', () => {
    let flaky: User
    let flakyClient: BrowserClient
    let invalid: User
    let fine: User

    beforeAll(async () => {
      flaky = await createUser('1234')
      invalid = await createUser('1234')
      fine = await createUser('1234')
      for (const user of [flaky, invalid, fine]) await makeReady(admin, user.userId)
      flakyClient = await signedInClient(flaky.phone, flaky.pin)
      const invalidClient = await signedInClient(invalid.phone, invalid.pin)
      await saveMonthlyFeedback(flakyClient, flaky.userId, MONTH, 'All good [mock:unavailable]')
      await saveMonthlyFeedback(invalidClient, invalid.userId, MONTH, 'Fine [mock:out_of_range]')
    })

    it('one failing user never stops the others; raw output is preserved', async () => {
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'PROCESS',
        user_ids: [flaky.userId, invalid.userId, fine.userId],
      })
      expect(response.status).toBe(200)
      expect(response.body.batch).toMatchObject({ success: 1, failed: 2 })

      const [flakyAttempt] = await attemptsFor(admin, flaky.userId)
      expect(flakyAttempt).toMatchObject({
        status: 'FAILED',
        failure_reason: 'Provider unavailable',
      })
      const flakyUsage = await must(
        admin
          .from('ai_usage_records')
          .select('succeeded, error_message')
          .eq('processing_user_id', flakyAttempt?.id ?? ''),
      )
      // Retryable: one retry (ai_max_retries = 1), both recorded.
      expect(flakyUsage).toEqual([
        { succeeded: false, error_message: 'Provider unavailable' },
        { succeeded: false, error_message: 'Provider unavailable' },
      ])

      const [invalidAttempt] = await attemptsFor(admin, invalid.userId)
      expect(invalidAttempt).toMatchObject({
        status: 'FAILED',
        failure_reason: 'Target out of range: calories',
        parsed_recommendation_json: null,
      })
      const raw = invalidAttempt?.raw_output_json as { text: string; validation: { code: string } }
      expect(raw.text).toContain('12000')
      expect(raw.validation.code).toBe('TARGET_OUT_OF_RANGE')

      expect(await cyclesFor(admin, flaky.userId)).toHaveLength(0)
      expect(await cyclesFor(admin, invalid.userId)).toHaveLength(0)
      expect(await cyclesFor(admin, fine.userId)).toHaveLength(1)

      // A failure does not lock feedback: the window stays open.
      expect(await fetchMonthlyFeedback(flakyClient, flaky.userId, TODAY)).toMatchObject({
        locked: false,
        processed: false,
      })
      const overview = await fetchOverview(adminSession)
      expect(overview.find((user) => user.userId === flaky.userId)).toMatchObject({
        state: 'FAILED',
        failureReason: 'Provider unavailable',
      })
      expect(await fetchPlan(flakyClient, flaky.userId, TODAY)).toMatchObject({
        recommendation: null,
      })
    })

    it('a failed user can be retried; a successful one is not', async () => {
      await saveMonthlyFeedback(flakyClient, flaky.userId, MONTH, 'Please keep sessions short.')
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'RETRY',
        user_ids: [flaky.userId, fine.userId],
      })
      expect(response.body).toMatchObject({ queued: 1, skipped_at_queue: 1 })
      expect(response.body.batch).toMatchObject({ success: 1 })
      const attempts = await attemptsFor(admin, flaky.userId)
      expect(attempts.map((a) => [a.status, a.attempt_number])).toEqual([
        ['FAILED', 1],
        ['SUCCESS', 2],
      ])
      expect(input(attempts[1] as { raw_input_json: Json }).feedback).toBe(
        'Please keep sessions short.',
      )
      expect(await cyclesFor(admin, fine.userId)).toHaveLength(1)
    })

    it('reprocess is explicit, creates a new attempt and keeps the previous recommendation', async () => {
      const before = await cyclesFor(admin, first.userId)
      expect(before).toHaveLength(1)
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'REPROCESS',
        user_ids: [first.userId],
      })
      expect(response.body.batch).toMatchObject({ success: 1 })

      const cycles = await cyclesFor(admin, first.userId)
      expect(cycles).toHaveLength(2)
      const [replaced, current] = cycles
      expect(replaced).toMatchObject({
        id: before[0]?.id,
        status: 'REPLACED',
        recommended_calories: before[0]?.recommended_calories,
        final_calories: before[0]?.final_calories,
      })
      expect(current).toMatchObject({ status: 'IN_REVIEW', period_start: TODAY })
      const attempts = await attemptsFor(admin, first.userId)
      expect(attempts.map((a) => a.status)).toEqual(['SUCCESS', 'SKIPPED', 'SKIPPED', 'SUCCESS'])
      // Same basis as the replaced one: still a first recommendation.
      expect(input(attempts[3] as { raw_input_json: Json }).first_recommendation).toBe(true)

      const feedback = await must(
        admin
          .from('recommendation_feedback')
          .select('recommendation_cycle_id')
          .eq('user_id', first.userId)
          .single(),
      )
      expect(feedback.recommendation_cycle_id).toBe(current?.id)
      const plan = await fetchPlan(firstClient, first.userId, TODAY)
      expect(plan.recommendation?.id).toBe(current?.id)
      const todaySnapshot = await must(
        admin
          .from('daily_target_snapshots')
          .select('recommendation_cycle_id')
          .eq('user_id', first.userId)
          .eq('target_date', TODAY)
          .single(),
      )
      expect(todaySnapshot.recommendation_cycle_id).toBe(current?.id)
    })

    it('concurrent requests never create two recommendations for one user', async () => {
      const racer = await createUser('1234')
      await makeReady(admin, racer.userId)
      const body = { action: 'start', mode: 'PROCESS', user_ids: [racer.userId] }
      const responses = await Promise.all([
        callProcessing(adminSession, body),
        callProcessing(adminSession, body),
      ])
      expect(responses.map((response) => response.status)).toEqual([200, 200])
      const cycles = await cyclesFor(admin, racer.userId)
      expect(cycles.filter((cycle) => cycle.status !== 'REPLACED')).toHaveLength(1)
      const attempts = await attemptsFor(admin, racer.userId)
      expect(attempts.filter((attempt) => attempt.status === 'SUCCESS')).toHaveLength(1)
    })

    it('process all ready queues ready users only', async () => {
      const ready = await createUser('1234')
      await makeReady(admin, ready.userId)
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'PROCESS',
        process_all_ready: true,
      })
      expect(response.status).toBe(200)
      await drainPending(adminSession)
      expect((await attemptsFor(admin, ready.userId)).map((a) => a.status)).toEqual(['SUCCESS'])
      // The incomplete user was not queued again.
      expect(await attemptsFor(admin, incomplete.userId)).toHaveLength(1)
    })

    it('stale PROCESSING attempts are recovered as FAILED, then retryable', async () => {
      const stale = await createUser('1234')
      await makeReady(admin, stale.userId)
      const staleRun = await must(
        admin
          .from('recommendation_processing_runs')
          .insert({ processing_month: MONTH, status: 'RUNNING' })
          .select('id')
          .single(),
      )
      await run(
        admin.from('recommendation_processing_users').insert({
          processing_run_id: staleRun.id,
          user_id: stale.userId,
          status: 'PROCESSING',
          processing_month: MONTH,
          reserved_cost: 5,
          started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
      )
      await callProcessing(adminSession, { action: 'continue' })
      const [recovered] = await attemptsFor(admin, stale.userId)
      expect(recovered).toMatchObject({
        status: 'FAILED',
        failure_reason: 'Processing interrupted',
        reserved_cost: null,
      })
      const retry = await callProcessing(adminSession, {
        action: 'start',
        mode: 'RETRY',
        user_ids: [stale.userId],
      })
      expect(retry.body.batch).toMatchObject({ success: 1 })
    })
  })

  describe('budget', () => {
    it('is required before processing starts', async () => {
      await setSetting(admin, 'ai_monthly_budget', null)
      try {
        const response = await callProcessing(adminSession, { action: 'continue' })
        expect(response).toMatchObject({ status: 409, body: { error: 'BUDGET_NOT_CONFIGURED' } })
      } finally {
        await setSetting(admin, 'ai_monthly_budget', 100000)
      }
    })

    it('stops at the budget with remaining users PENDING, and resumes when raised', async () => {
      const a = await createUser('1234')
      const b = await createUser('1234')
      await makeReady(admin, a.userId)
      await makeReady(admin, b.userId)
      // 1 INR per output token, nothing for input, 1000 output tokens, no retries:
      // every attempt reserves exactly 1000 INR.
      await setSetting(admin, 'ai_pricing', {
        version: 'test-budget',
        currency: 'INR',
        models: { 'mock-recommender-1': { input_per_million: 0, output_per_million: 1_000_000 } },
      })
      await setSetting(admin, 'ai_max_retries', 0)
      await setSetting(admin, 'ai_max_output_tokens', 1000)
      try {
        const usage = await fetchUsage(adminSession, MONTH)
        expect(usage.reserved).toBe(0)
        // Exactly one attempt fits (spent + reservation = budget is allowed).
        await setSetting(admin, 'ai_monthly_budget', usage.estimatedSpend + 1000)

        const response = await callProcessing(adminSession, {
          action: 'start',
          mode: 'PROCESS',
          user_ids: [a.userId, b.userId],
        })
        expect(response.status).toBe(200)
        expect(response.body.batch).toMatchObject({ success: 1, stopped_by_budget: true })
        const runId = response.body.run_id as string
        expect(response.body.runs).toMatchObject({ [runId]: 'STOPPED_BUDGET' })
        const statuses = [
          ...(await attemptsFor(admin, a.userId)),
          ...(await attemptsFor(admin, b.userId)),
        ].map((attempt) => attempt.status)
        expect(statuses.sort()).toEqual(['PENDING', 'SUCCESS'])
        const runRow = await must(
          admin
            .from('recommendation_processing_runs')
            .select('status, failure_reason')
            .eq('id', runId)
            .single(),
        )
        expect(runRow).toMatchObject({
          status: 'STOPPED_BUDGET',
          failure_reason: 'Monthly AI budget reached',
        })
        const after = await fetchUsage(adminSession, MONTH)
        expect(after.estimatedSpend).toBeGreaterThan(usage.estimatedSpend)
        expect(after.remaining).toBeLessThan(1000)

        // Still over budget: nothing more starts.
        const blocked = await callProcessing(adminSession, { action: 'continue' })
        expect(blocked.body.batch).toMatchObject({ success: 0, stopped_by_budget: true })

        await setSetting(admin, 'ai_monthly_budget', 100000)
        const resumed = await callProcessing(adminSession, { action: 'continue' })
        expect(resumed.body.batch).toMatchObject({ success: 1 })
        expect(resumed.body.runs).toMatchObject({ [runId]: 'COMPLETED' })
      } finally {
        await setSetting(admin, 'ai_pricing', saved.get('ai_pricing'))
        await setSetting(admin, 'ai_max_retries', saved.get('ai_max_retries') ?? 1)
        await setSetting(admin, 'ai_max_output_tokens', saved.get('ai_max_output_tokens') ?? 4000)
        await setSetting(admin, 'ai_monthly_budget', 100000)
      }
    })
  })

  describe('history', () => {
    it('keeps every attempt, readable by admins only', async () => {
      const page = await fetchHistory(adminSession, 0)
      expect(page.total).toBeGreaterThanOrEqual(10)
      expect(page.rows.length).toBeGreaterThan(0)
      expect(page.rows[0]).toHaveProperty('promptVersion')
      const denied = await fetchHistory(plainClient, 0)
      expect(denied).toEqual({ rows: [], total: 0 })
      const deletion = await adminSession
        .from('recommendation_processing_users')
        .delete()
        .eq('user_id', first.userId)
      expect(deletion.error).not.toBeNull()
      expect(await attemptsFor(admin, first.userId)).toHaveLength(4)
    })
  })
})
