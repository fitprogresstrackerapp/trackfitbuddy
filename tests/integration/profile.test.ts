/**
 * Profile against the real database and storage, through the app's data
 * functions as signed-in users (RLS applies): profile, goals, steps, weight,
 * InBody precedence and files, recommendation review, and isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  acceptRecommendation,
  deleteSteps,
  fetchInbodyReports,
  fetchPlan,
  fetchProfileDetails,
  fetchRecentSteps,
  fetchWeights,
  INBODY_BUCKET,
  logSteps,
  logWeight,
  reviewRecommendation,
  saveGoal,
  updateCapacity,
  updateLifestyle,
  updatePersonal,
  updateWeight,
  uploadInbodyReport,
} from '@/features/profile/api/profile-data'
import { stepsByDay } from '@/features/profile/lib/profile-logic'
import { addDays } from '@/lib/dates/local-date'

import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must, TODAY } from './home-fixtures.ts'
import { seedInbody, seedRecommendation } from './profile-fixtures.ts'

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('Profile', () => {
  const admin = adminClient()
  let owner: { userId: string; phone: string; pin: string }
  let other: { userId: string; phone: string; pin: string }
  let ownerClient: BrowserClient
  let otherClient: BrowserClient
  let cycleId: string

  beforeAll(async () => {
    owner = await createUser('1234')
    other = await createUser('4321')
    await completeProfile(admin, owner.userId)
    await completeProfile(admin, other.userId)
    ;({ cycleId } = await seedRecommendation(admin, owner.userId, TODAY))
    ownerClient = await signedInClient(owner.phone, owner.pin)
    otherClient = await signedInClient(other.phone, other.pin)
  })

  describe('profile', () => {
    it('reads and updates the own profile; optional fields stay optional', async () => {
      await updatePersonal(ownerClient, owner.userId, {
        name: 'Asha Rao',
        dateOfBirth: '1994-05-17',
        gender: 'PREFER_NOT_TO_SAY',
      })
      await updateLifestyle(ownerClient, owner.userId, {
        activityLevel: 'VERY_ACTIVE',
        job: 'Engineer',
        hobbies: 'Cricket',
      })
      await updateLifestyle(ownerClient, owner.userId, {
        activityLevel: null,
        job: null,
        hobbies: null,
      })
      const details = await fetchProfileDetails(ownerClient, owner.userId)
      expect(details).toMatchObject({
        name: 'Asha Rao',
        gender: 'PREFER_NOT_TO_SAY',
        activityLevel: null,
        job: null,
      })
      const readiness = await must(
        ownerClient
          .from('profile_readiness')
          .select('is_profile_complete')
          .eq('user_id', owner.userId)
          .single(),
      )
      expect(readiness.is_profile_complete).toBe(true)
    })

    it('cannot read or update another profile', async () => {
      await expect(fetchProfileDetails(otherClient, owner.userId)).rejects.toBeTruthy()
      const { data } = await otherClient
        .from('profiles')
        .update({ name: 'Hacked' })
        .eq('id', owner.userId)
        .select('id')
      expect(data).toEqual([])
    })

    it('a capacity change is a next-cycle preference; the current cycle is unchanged', async () => {
      await updateCapacity(ownerClient, owner.userId, 5)
      expect((await fetchProfileDetails(ownerClient, owner.userId)).workoutDaysPerWeek).toBe(5)
      const plan = await fetchPlan(ownerClient, owner.userId, TODAY)
      expect(plan.recommendation?.capacity).toBe(3)
    })
  })

  describe('goals', () => {
    it('a new goal version is created; the cycle keeps its locked goal', async () => {
      await saveGoal(ownerClient, {
        longTermGoal: 'MUSCLE_GAIN',
        focuses: ['CRICKET_PERFORMANCE', 'ENDURANCE'],
        objective: 'Stronger for cricket',
      })
      const plan = await fetchPlan(ownerClient, owner.userId, TODAY)
      expect(plan.activeGoal).toMatchObject({
        longTermGoal: 'MUSCLE_GAIN',
        description: 'Stronger for cricket',
        focuses: ['CRICKET_PERFORMANCE', 'ENDURANCE'],
      })
      expect(plan.recommendation?.goal).toMatchObject({
        longTermGoal: 'FAT_LOSS',
        focuses: ['MUSCLE_BUILDING'],
      })
    })

    it('another user cannot read the goals', async () => {
      const { data } = await otherClient.from('goals').select('id').eq('user_id', owner.userId)
      expect(data).toEqual([])
      const plan = await fetchPlan(otherClient, owner.userId, TODAY)
      expect(plan.activeGoal?.longTermGoal).not.toBe('MUSCLE_GAIN')
    })
  })

  describe('steps', () => {
    it('keeps every entry; the latest is active; nothing is summed', async () => {
      await logSteps(ownerClient, { date: TODAY, steps: 4000 })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await logSteps(ownerClient, { date: TODAY, steps: 8420 })
      const entries = await fetchRecentSteps(ownerClient, owner.userId, TODAY)
      const today = stepsByDay(entries).find((day) => day.date === TODAY)
      expect(today?.active).toBe(8420)
      expect(today?.entries.map((entry) => [entry.steps, entry.isActive])).toEqual([
        [8420, true],
        [4000, false],
      ])
      const daily = await must(
        ownerClient
          .from('daily_steps')
          .select('steps')
          .eq('user_id', owner.userId)
          .eq('entry_date', TODAY)
          .single(),
      )
      expect(daily.steps).toBe(8420)
    })

    it('deleting today’s active entry re-activates the previous one', async () => {
      const entries = await fetchRecentSteps(ownerClient, owner.userId, TODAY)
      const active = entries.find((entry) => entry.date === TODAY && entry.isActive)
      if (!active) throw new Error('active entry missing')
      await deleteSteps(ownerClient, active.id)
      const after = stepsByDay(await fetchRecentSteps(ownerClient, owner.userId, TODAY))
      expect(after.find((day) => day.date === TODAY)?.active).toBe(4000)
    })

    it('past days: a missing day can be added once, then it is locked; future rejected', async () => {
      await logSteps(ownerClient, { date: addDays(TODAY, -2), steps: 6000 })
      await expectError(logSteps(ownerClient, { date: addDays(TODAY, -2), steps: 9000 }), '42501')
      const past = (await fetchRecentSteps(ownerClient, owner.userId, TODAY)).find(
        (entry) => entry.date === addDays(TODAY, -2),
      )
      if (!past) throw new Error('past entry missing')
      await expectError(deleteSteps(ownerClient, past.id), '42501')
      await expectError(logSteps(ownerClient, { date: addDays(TODAY, 1), steps: 100 }), '22023')
    })

    it('another user cannot read or change the steps', async () => {
      expect(await fetchRecentSteps(otherClient, owner.userId, TODAY)).toEqual([])
    })
  })

  describe('weight', () => {
    it('adds measurements as history; the latest is current', async () => {
      await logWeight(ownerClient, { date: TODAY, weightKg: 72.4 })
      const weights = await fetchWeights(ownerClient, owner.userId)
      expect(weights.current).toMatchObject({ date: TODAY, weightKg: 72.4, source: 'MANUAL' })
      // The onboarding weight (TODAY-2) is still in the history.
      expect(weights.recent.map((entry) => entry.weightKg)).toEqual(
        expect.arrayContaining([72.4, 61.5]),
      )
    })

    it('InBody wins on its date; the manual entry is preserved', async () => {
      const day = addDays(TODAY, -1)
      await logWeight(ownerClient, { date: day, weightKg: 73.0 }) // late entry
      await seedInbody(admin, owner.userId, day, { weight: 72.8, fat: 22.4, muscle: 32.1 })
      const weights = await fetchWeights(ownerClient, owner.userId)
      const onDay = weights.recent.filter((entry) => entry.date === day)
      expect(onDay.map((entry) => entry.source).sort()).toEqual(['INBODY', 'MANUAL'])
      const reports = await fetchInbodyReports(ownerClient, owner.userId)
      expect(reports[0]?.metrics).toMatchObject({ bodyFatPercent: 22.4, muscleMassKg: 32.1 })
    })

    it('past measurements are locked; future dates are rejected', async () => {
      const weights = await fetchWeights(ownerClient, owner.userId)
      const past = weights.recent.find((entry) => entry.date < TODAY && entry.source === 'MANUAL')
      if (!past) throw new Error('past weight missing')
      await expectError(updateWeight(ownerClient, past.id, 70), '42501')
      await expectError(logWeight(ownerClient, { date: addDays(TODAY, 1), weightKg: 70 }), '22023')
    })

    it('another user cannot read the weights or InBody results', async () => {
      const weights = await fetchWeights(otherClient, owner.userId)
      expect(weights).toEqual({ current: null, recent: [] })
      expect(await fetchInbodyReports(otherClient, owner.userId)).toEqual([])
    })
  })

  describe('InBody files', () => {
    it('stores the original report privately; only the owner can read it', async () => {
      const file = new File(['%PDF-1.4\n%%EOF\n'], 'scan.pdf', { type: 'application/pdf' })
      await uploadInbodyReport(ownerClient, owner.userId, { date: TODAY, file })
      const reports = await fetchInbodyReports(ownerClient, owner.userId)
      const uploaded = reports.find((report) => report.date === TODAY)
      expect(uploaded).toMatchObject({ status: 'PENDING', metrics: null })
      if (!uploaded) throw new Error('report missing')
      expect(uploaded.filePath.startsWith(`${owner.userId}/`)).toBe(true)

      const own = await ownerClient.storage.from(INBODY_BUCKET).download(uploaded.filePath)
      expect(own.error).toBeNull()
      const foreign = await otherClient.storage.from(INBODY_BUCKET).download(uploaded.filePath)
      expect(foreign.data).toBeNull()

      // Nobody can place a file in someone else's folder.
      const intrusion = await otherClient.storage
        .from(INBODY_BUCKET)
        .upload(`${owner.userId}/intruder.pdf`, file, { contentType: 'application/pdf' })
      expect(intrusion.error).not.toBeNull()
    })
  })

  describe('recommendation review', () => {
    it('edits final targets during review; the original is preserved and audited', async () => {
      await reviewRecommendation(ownerClient, cycleId, {
        calories: 1900,
        proteinG: 150,
        carbsG: 220,
        fatG: 60,
        fiberG: 32,
        sessions: ['Push', 'Pull', 'Legs'],
      })
      const plan = await fetchPlan(ownerClient, owner.userId, TODAY)
      expect(plan.recommendation).toMatchObject({
        recommended: { calories: 2000, proteinG: 140 },
        final: { calories: 1900, proteinG: 150 },
        sessions: ['Push', 'Pull', 'Legs'],
        originalSessions: ['Upper body', 'Lower body', 'Full body'],
      })
      const snapshot = await must(
        ownerClient
          .from('daily_target_snapshots')
          .select('calories')
          .eq('user_id', owner.userId)
          .eq('target_date', TODAY)
          .single(),
      )
      expect(snapshot.calories).toBe(1900)
      const audit = await must(
        admin
          .from('audit_logs')
          .select('actor_user_id, old_values_json, new_values_json, created_at')
          .eq('entity_id', cycleId)
          .order('created_at'),
      )
      const change = audit.find((row) =>
        JSON.stringify(row.new_values_json).includes('final_calories'),
      )
      expect(change?.actor_user_id).toBe(owner.userId)
      expect(change?.old_values_json).toMatchObject({ final_calories: 2000 })
      expect(change?.new_values_json).toMatchObject({ final_calories: 1900 })
    })

    it('another user cannot review it', async () => {
      await expectError(acceptRecommendation(otherClient, cycleId), 'P0002')
    })

    it('accept & lock ends the review; later edits are rejected', async () => {
      await acceptRecommendation(ownerClient, cycleId)
      const plan = await fetchPlan(ownerClient, owner.userId, TODAY)
      expect(plan.recommendation?.status).toBe('LOCKED')
      await expectError(
        reviewRecommendation(ownerClient, cycleId, {
          calories: 1800,
          proteinG: 150,
          carbsG: 220,
          fatG: 60,
          fiberG: 32,
          sessions: [],
        }),
        '42501',
      )
    })

    it('a recommendation past its review window cannot be edited even if never accepted', async () => {
      const late = await createUser('2468')
      await completeProfile(admin, late.userId)
      const { cycleId: oldCycle } = await seedRecommendation(admin, late.userId, addDays(TODAY, -5))
      const client = await signedInClient(late.phone, late.pin)
      await expectError(acceptRecommendation(client, oldCycle), '42501')
    })
  })
})
