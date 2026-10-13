/**
 * Groups weekly view against the real local stack, as signed-in users through
 * the app's own data functions: access and group scope, former members, the
 * join-day rule, and agreement with Progress. A member's week in the group
 * must equal what that member's own Progress shows for the same days.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { fetchGroupWeek, joinGroup, leaveGroup } from '@/features/groups/api/groups-data'
import { groupWeeks, memberWeeks } from '@/features/groups/lib/group-week'
import {
  fetchNutritionPeriod,
  fetchStepsPeriod,
  fetchTrainingPeriod,
} from '@/features/progress/api/progress-data'
import {
  datesIn,
  nutritionSeries,
  stepsSummary,
  summarizeNutrition,
  targetsByDate,
  weeklyTraining,
} from '@/features/progress/lib/progress-logic'
import { addDays } from '@/lib/dates/local-date'

import { seedFoods, seedPastMeal } from './food-fixtures.ts'
import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { must, run, TODAY } from './home-fixtures.ts'
import { makeReady, PREVIOUS_START, seedPreviousCycle } from './recommendation-fixtures.ts'
import { seedLockedActivity, seedLockedWorkout } from './training-fixtures.ts'

const WEEKS = groupWeeks(TODAY)
const LAST = WEEKS.previous

const ALLOWED_KEYS = [
  'calorie_lower_tolerance',
  'calorie_upper_tolerance',
  'calories',
  'calories_target',
  'cycle_start',
  'day',
  'group_role',
  'name',
  'nutrition_tolerance',
  'protein_g',
  'protein_target_g',
  'steps',
  'user_id',
  'workout_logged',
  'workouts_per_week',
]

describe('Groups weekly view', () => {
  const admin = adminClient()
  let ownerClient: BrowserClient
  let memberClient: BrowserClient
  let lateClient: BrowserClient
  let outsiderClient: BrowserClient
  let memberId: string
  let lateId: string
  let groupId: string

  beforeAll(async () => {
    const owner = await createUser('1234')
    const member = await createUser('1234')
    const late = await createUser('1234')
    const outsider = await createUser('1234')
    memberId = member.userId
    lateId = late.userId
    for (const [user, name] of [
      [owner, 'Ola'],
      [member, 'Mo'],
      [late, 'Lee'],
      [outsider, 'Oz'],
    ] as const) {
      await run(admin.from('profiles').update({ name }).eq('id', user.userId))
    }

    // Mo: a plan with daily targets and tolerance (capacity 3), food on three
    // days of last week, two workouts on one day plus an activity, two steps
    // entries on one day (the later one counts).
    const goal = await makeReady(admin, member.userId, { effectiveFrom: PREVIOUS_START })
    await run(admin.from('profiles').update({ name: 'Mo' }).eq('id', member.userId))
    await seedPreviousCycle(admin, member.userId, goal, 3)
    const foods = await seedFoods(admin)
    await seedPastMeal(admin, member.userId, LAST.start, foods.chicken.id, 600)
    await seedPastMeal(admin, member.userId, addDays(LAST.start, 1), foods.curry.id, 6)
    await seedPastMeal(admin, member.userId, addDays(LAST.start, 2), foods.idli.id, 4)
    await seedLockedWorkout(admin, member.userId, addDays(LAST.start, 1), 'LEGS')
    await seedLockedWorkout(admin, member.userId, addDays(LAST.start, 1), 'CARDIO')
    await seedLockedWorkout(admin, member.userId, addDays(LAST.start, 3), 'UPPER_BODY')
    await seedLockedActivity(admin, member.userId, addDays(LAST.start, 4))
    await run(
      admin
        .from('steps_entries')
        .insert({ user_id: member.userId, entry_date: LAST.start, steps: 4000 }),
    )
    await run(
      admin
        .from('steps_entries')
        .insert({ user_id: member.userId, entry_date: LAST.start, steps: 9000 }),
    )

    // A group that started a month ago (trusted setup: the app only creates
    // groups "now"). Mo has been a member since then; Lee joined last Wednesday.
    const group = await must(
      admin
        .from('groups')
        .insert({
          name: 'Weekly crew',
          creator_id: owner.userId,
          created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        })
        .select('id, code')
        .single(),
    )
    groupId = group.id
    await run(
      admin.from('group_memberships').insert([
        {
          group_id: groupId,
          user_id: member.userId,
          role: 'MEMBER',
          joined_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        },
        {
          group_id: groupId,
          user_id: late.userId,
          role: 'MEMBER',
          joined_at: `${addDays(LAST.start, 2)}T04:00:00Z`,
        },
      ]),
    )
    ownerClient = await signedInClient(owner.phone, owner.pin)
    memberClient = await signedInClient(member.phone, member.pin)
    lateClient = await signedInClient(late.phone, late.pin)
    outsiderClient = await signedInClient(outsider.phone, outsider.pin)
  })

  it('returns only group-visible fields', async () => {
    const { data, error } = await ownerClient.rpc('get_group_member_week', {
      p_group_id: groupId,
      p_week_start: LAST.start,
    })
    expect(error).toBeNull()
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(ALLOWED_KEYS)
    expect(JSON.stringify(data)).not.toMatch(
      /weight|fat_percent|inbody|bmr|phone|birth|score|rank/i,
    )
  })

  it('a member’s week in the group equals their own Progress for the same days', async () => {
    const seen = memberWeeks(await fetchGroupWeek(ownerClient, groupId, LAST.start), LAST, TODAY)
    const mo = seen.find((member) => member.userId === memberId)
    expect(mo).toBeDefined()

    // Mo's own Progress, computed exactly as the Progress page does.
    const nutrition = await fetchNutritionPeriod(memberClient, memberId, LAST)
    const targets = targetsByDate(datesIn(LAST), nutrition.snapshots, nutrition.cycles)
    const summary = summarizeNutrition(
      nutritionSeries(LAST, nutrition.days, targets),
      targets,
      TODAY,
    )
    const training = await fetchTrainingPeriod(memberClient, memberId, LAST)
    const trainingTargets = targetsByDate(
      datesIn(training.fetched),
      training.snapshots,
      training.cycles,
    )
    const [week] = weeklyTraining(LAST, training.workouts, trainingTargets, training.cycles, TODAY)
    const steps = stepsSummary(await fetchStepsPeriod(memberClient, memberId, LAST))

    expect(mo?.nutrition).toEqual(summary.nutrients.calories.adherence)
    expect(mo?.protein).toEqual(summary.nutrients.proteinG.adherence)
    expect(mo?.nutrition.eligible).toBe(3)
    expect(mo?.workouts).toEqual({
      done: week?.done,
      capacity: week?.capacity,
      status: week?.status,
    })
    // Two workouts on one day are one day; the activity is not a workout.
    expect(mo?.workouts).toMatchObject({ done: 2, capacity: 3 })
    // The later steps entry of the day counts.
    expect(mo?.steps).toEqual(steps)
    expect(mo?.steps).toEqual({ average: 9000, days: 1 })
  })

  it('counts a member from the day they joined, and a member sees only from their own join day', async () => {
    const seen = await fetchGroupWeek(ownerClient, groupId, LAST.start)
    const leeDays = seen.filter((day) => day.userId === lateId).map((day) => day.date)
    expect(leeDays[0]).toBe(addDays(LAST.start, 2))
    const own = await fetchGroupWeek(lateClient, groupId, LAST.start)
    expect(own.every((day) => day.date >= addDays(LAST.start, 2))).toBe(true)
  })

  it('never returns a day after today', async () => {
    const thisWeek = await fetchGroupWeek(ownerClient, groupId, WEEKS.current.start)
    expect(thisWeek.every((day) => day.date <= TODAY)).toBe(true)
    expect(thisWeek.some((day) => day.date === TODAY)).toBe(true)
  })

  it('outsiders, other groups and former members get nothing', async () => {
    await expect(fetchGroupWeek(outsiderClient, groupId, LAST.start)).rejects.toMatchObject({
      code: '42501',
    })
    // Joining another group gives nothing here.
    const other = await must(
      admin
        .from('groups')
        .insert({
          name: 'Other crew',
          creator_id: (await outsiderClient.auth.getUser()).data.user?.id ?? '',
        })
        .select('id, code')
        .single(),
    )
    await joinGroup(lateClient, other.code)
    await expect(fetchGroupWeek(outsiderClient, groupId, LAST.start)).rejects.toMatchObject({
      code: '42501',
    })

    await leaveGroup(lateClient, groupId)
    await expect(fetchGroupWeek(lateClient, groupId, LAST.start)).rejects.toMatchObject({
      code: '42501',
    })
    const after = await fetchGroupWeek(ownerClient, groupId, LAST.start)
    expect(after.some((day) => day.userId === lateId)).toBe(false)
  })
})
