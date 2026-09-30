/**
 * Groups & shared progress against the real local stack, as signed-in users
 * through the app's own data functions (RLS and the group functions apply):
 * creation, joining, isolation between groups, group-visible fields only,
 * targets by date, the history rule, removal, leaving and privacy.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import {
  createGroup,
  fetchGroupDay,
  fetchGroupMembers,
  fetchMyGroups,
  joinGroup,
  leaveGroup,
  previewGroup,
  removeMember,
  setMemberRole,
} from '@/features/groups/api/groups-data'
import { fetchNutritionPeriod } from '@/features/progress/api/progress-data'
import { addDays } from '@/lib/dates/local-date'

import { seedFoods, seedPastMeal } from './food-fixtures.ts'
import { adminClient, createUser, signedInClient, type BrowserClient } from './helpers.ts'
import { must, run, TODAY } from './home-fixtures.ts'
import { seedInbody } from './profile-fixtures.ts'
import { makeReady, PREVIOUS_START, seedPreviousCycle } from './recommendation-fixtures.ts'
import { seedLockedWorkout } from './training-fixtures.ts'

interface User {
  userId: string
  phone: string
  pin: string
}

const MEMBER_DAY_KEYS = [
  'calories',
  'calories_target',
  'group_role',
  'name',
  'protein_g',
  'protein_target_g',
  'steps',
  'steps_target',
  'user_id',
  'workout_logged',
]

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('Groups', () => {
  const admin = adminClient()
  let ana: User
  let ben: User
  let cai: User
  let dev: User
  let anaClient: BrowserClient
  let benClient: BrowserClient
  let caiClient: BrowserClient
  let devClient: BrowserClient
  let g1: { id: string; code: string }
  let g2: { id: string; code: string }
  const pastDate = addDays(TODAY, -5)

  beforeAll(async () => {
    ana = await createUser('1234')
    ben = await createUser('1234')
    cai = await createUser('1234')
    dev = await createUser('1234')
    for (const [user, name] of [
      [ana, 'Ana'],
      [ben, 'Ben'],
      [cai, 'Cai'],
      [dev, 'Dev'],
    ] as const) {
      await run(admin.from('profiles').update({ name }).eq('id', user.userId))
    }

    // Ben: a recommendation from PREVIOUS_START (2,000 kcal snapshots up to
    // yesterday), today's snapshot at 1,800 kcal, meals, steps, two workouts
    // today, and private body data.
    const goal = await makeReady(admin, ben.userId, { effectiveFrom: PREVIOUS_START })
    await run(admin.from('profiles').update({ name: 'Ben' }).eq('id', ben.userId))
    const cycleId = await seedPreviousCycle(admin, ben.userId, goal, 3)
    await run(
      admin.from('daily_target_snapshots').insert({
        user_id: ben.userId,
        recommendation_cycle_id: cycleId,
        target_date: TODAY,
        calories: 1800,
        protein_g: 130,
        carbs_g: 200,
        fat_g: 60,
        fiber_g: 30,
        workouts_per_week: 3,
        nutrition_tolerance: 0.85,
        calorie_lower_tolerance: 0.85,
        calorie_upper_tolerance: 1.1,
      }),
    )
    const foods = await seedFoods(admin)
    await seedPastMeal(admin, ben.userId, TODAY, foods.chicken.id, 2)
    await seedPastMeal(admin, ben.userId, pastDate, foods.idli.id, 4)
    await run(
      admin.from('steps_entries').insert({ user_id: ben.userId, entry_date: TODAY, steps: 7842 }),
    )
    await seedLockedWorkout(admin, ben.userId, TODAY, 'LEGS')
    await seedLockedWorkout(admin, ben.userId, TODAY, 'CARDIO')
    await seedInbody(admin, ben.userId, addDays(TODAY, -3), {
      weight: 81.2,
      fat: 23.4,
      muscle: 33.3,
    })

    anaClient = await signedInClient(ana.phone, ana.pin)
    benClient = await signedInClient(ben.phone, ben.pin)
    caiClient = await signedInClient(cai.phone, cai.pin)
    devClient = await signedInClient(dev.phone, dev.pin)
  })

  describe('creating and joining', () => {
    it('creation is atomic: the code is generated server-side and the creator is group admin', async () => {
      g1 = await createGroup(anaClient, { name: '  Morning crew ', description: 'Walks and lifts' })
      expect(g1.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
      const [group] = (await fetchMyGroups(anaClient)).filter((item) => item.id === g1.id)
      expect(group).toMatchObject({
        name: 'Morning crew',
        description: 'Walks and lifts',
        myRole: 'ADMIN',
        memberCount: 1,
        historyFrom: TODAY,
      })
    })

    it('a valid code is confirmed, then joined immediately; duplicates are prevented', async () => {
      const typed = `${g1.code.slice(0, 4).toLowerCase()}-${g1.code.slice(4).toLowerCase()}`
      expect(await previewGroup(benClient, typed)).toMatchObject({
        id: g1.id,
        name: 'Morning crew',
        memberCount: 1,
        alreadyMember: false,
      })
      expect(await joinGroup(benClient, typed)).toBe(g1.id)
      expect(await joinGroup(benClient, g1.code)).toBe(g1.id)
      const members = await fetchGroupMembers(anaClient, g1.id)
      expect(members.map((member) => [member.name, member.role])).toEqual([
        ['Ana', 'ADMIN'],
        ['Ben', 'MEMBER'],
      ])
      expect((await previewGroup(benClient, g1.code))?.alreadyMember).toBe(true)
    })

    it('an invalid code reveals nothing', async () => {
      expect(await previewGroup(benClient, 'ZZZZZZZZ')).toBeNull()
      await expectCode(joinGroup(benClient, 'ZZZZZZZZ'), 'P0002')
    })

    it('a user can belong to several groups; one group never shows another’s members', async () => {
      g2 = await createGroup(caiClient, { name: 'Weekend riders', description: null })
      await joinGroup(devClient, g1.code)
      await joinGroup(devClient, g2.code)
      expect((await fetchMyGroups(devClient)).map((group) => group.name).sort()).toEqual([
        'Morning crew',
        'Weekend riders',
      ])
      const g2Day = await fetchGroupDay(caiClient, g2.id, TODAY)
      expect(g2Day.map((member) => member.name).sort()).toEqual(['Cai', 'Dev'])
      await expectCode(fetchGroupDay(benClient, g2.id, TODAY), '42501')
      await expectCode(fetchGroupMembers(caiClient, g1.id), '42501')
    })
  })

  describe('shared progress', () => {
    it('shows calories and protein against the member’s own target, steps and workout status', async () => {
      const [own] = (
        await fetchNutritionPeriod(benClient, ben.userId, { start: TODAY, end: TODAY })
      ).days
      const day = await fetchGroupDay(anaClient, g1.id, TODAY)
      const benDay = day.find((member) => member.userId === ben.userId)
      expect(benDay).toMatchObject({
        name: 'Ben',
        role: 'MEMBER',
        calories: own?.calories,
        proteinG: own?.proteinG,
        caloriesTarget: 1800,
        proteinTargetG: 130,
        steps: 7842,
        stepsTarget: null,
        // Two workouts today still count as one workout day.
        workoutLogged: true,
      })
      // Ana logged nothing: missing stays missing.
      expect(day.find((member) => member.userId === ana.userId)).toMatchObject({
        calories: null,
        proteinG: null,
        caloriesTarget: null,
        steps: null,
        workoutLogged: false,
      })
    })

    it('the API returns only group-visible fields — never private data', async () => {
      const { data, error } = await anaClient.rpc('get_group_member_day', {
        p_group_id: g1.id,
        p_date: TODAY,
      })
      expect(error).toBeNull()
      for (const row of data ?? []) expect(Object.keys(row).sort()).toEqual(MEMBER_DAY_KEYS)
      const text = JSON.stringify(data)
      expect(text).not.toMatch(
        /81\.2|23\.4|33\.3|61\.5|1992-03-14|FEMALE|\+91|Chicken|Idli|LEGS|CARDIO/,
      )
      const members = await anaClient.rpc('get_group_members', { p_group_id: g1.id })
      for (const row of members.data ?? []) {
        expect(Object.keys(row).sort()).toEqual(['group_role', 'joined_at', 'name', 'user_id'])
      }
    })

    it('private tables stay unreadable to group members', async () => {
      for (const table of [
        'weight_measurements',
        'inbody_reports',
        'inbody_metrics',
        'meals',
        'meal_items',
        'workouts',
        'steps_entries',
        'recommendation_cycles',
        'daily_target_snapshots',
        'recommendation_feedback',
        'goals',
      ] as const) {
        const { data } = await anaClient.from(table).select('user_id').eq('user_id', ben.userId)
        expect(data ?? [], table).toEqual([])
      }
      const profile = await anaClient.from('profiles').select('*').eq('id', ben.userId)
      expect(profile.data ?? []).toEqual([])
    })

    it('history: the target in force on each date; a member sees nothing before they joined', async () => {
      // A group whose history goes back: created 30 days ago with Ben since then.
      const past = await must(
        admin
          .from('groups')
          .insert({
            name: 'Long-standing',
            creator_id: ana.userId,
            created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          })
          .select('id, code')
          .single(),
      )
      await run(
        admin.from('group_memberships').insert({
          group_id: past.id,
          user_id: ben.userId,
          joined_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        }),
      )
      // Ana (group admin; history from group creation) views an earlier date.
      const earlier = await fetchGroupDay(anaClient, past.id, pastDate)
      const benEarlier = earlier.find((member) => member.userId === ben.userId)
      const [ownEarlier] = (
        await fetchNutritionPeriod(benClient, ben.userId, { start: pastDate, end: pastDate })
      ).days
      expect(benEarlier).toMatchObject({
        caloriesTarget: 2000,
        proteinTargetG: 140,
        calories: ownEarlier?.calories,
        steps: null,
        workoutLogged: false,
      })
      expect(
        (await fetchGroupDay(anaClient, past.id, TODAY)).find((m) => m.userId === ben.userId)
          ?.caloriesTarget,
      ).toBe(1800)

      // A member who joins today sees no earlier history.
      await joinGroup(caiClient, past.code)
      expect(await fetchGroupDay(caiClient, past.id, pastDate)).toEqual([])
      expect((await fetchMyGroups(caiClient)).find((g) => g.id === past.id)?.historyFrom).toBe(
        TODAY,
      )
      await expectCode(fetchGroupDay(anaClient, past.id, addDays(TODAY, 1)), '22023')
    })
  })

  describe('roles, removal and leaving', () => {
    it('only the group admin removes members; a leader cannot', async () => {
      await expectCode(removeMember(benClient, g1.id, dev.userId), '42501')
      await setMemberRole(anaClient, g1.id, dev.userId, 'LEADER')
      await expectCode(removeMember(devClient, g1.id, ben.userId), '42501')
      await expectCode(setMemberRole(devClient, g1.id, dev.userId, 'ADMIN'), '42501')
      // Admin of G1 has no power in G2.
      await expectCode(removeMember(anaClient, g2.id, dev.userId), '42501')
    })

    it('removal ends access immediately; personal records and the session remain', async () => {
      const before = await fetchNutritionPeriod(benClient, ben.userId, {
        start: pastDate,
        end: TODAY,
      })
      await removeMember(anaClient, g1.id, ben.userId)
      await expectCode(fetchGroupDay(benClient, g1.id, TODAY), '42501')
      await expectCode(fetchGroupDay(benClient, g1.id, pastDate), '42501')
      await expectCode(fetchGroupMembers(benClient, g1.id), '42501')
      expect((await fetchMyGroups(benClient)).map((g) => g.id)).not.toContain(g1.id)
      expect((await fetchGroupDay(anaClient, g1.id, TODAY)).map((m) => m.userId)).not.toContain(
        ben.userId,
      )
      const after = await fetchNutritionPeriod(benClient, ben.userId, {
        start: pastDate,
        end: TODAY,
      })
      expect(after.days).toEqual(before.days)
      const session = await benClient.auth.getUser()
      expect(session.data.user?.id).toBe(ben.userId)
    })

    it('any member may leave; the only admin must appoint another admin first', async () => {
      await expectCode(leaveGroup(anaClient, g1.id), 'P0001')
      await leaveGroup(devClient, g1.id)
      await expectCode(fetchGroupMembers(devClient, g1.id), '42501')
      // Dev keeps G2.
      expect((await fetchMyGroups(devClient)).map((g) => g.id)).toEqual([g2.id])
      expect((await fetchGroupMembers(anaClient, g1.id)).map((m) => m.name)).toEqual(['Ana'])
    })

    it('the last member leaving closes the group; its code no longer works', async () => {
      await leaveGroup(anaClient, g1.id)
      expect((await fetchMyGroups(anaClient)).map((g) => g.id)).not.toContain(g1.id)
      const row = await anaClient.from('groups').select('id').eq('id', g1.id)
      expect(row.data ?? []).toEqual([])
      expect(await previewGroup(benClient, g1.code)).toBeNull()
      await expectCode(joinGroup(benClient, g1.code), 'P0002')
    })

    it('a removed user can rejoin with the code; history restarts at the new join', async () => {
      await joinGroup(benClient, g2.code)
      const group = (await fetchMyGroups(benClient)).find((g) => g.id === g2.id)
      expect(group).toMatchObject({ myRole: 'MEMBER', historyFrom: TODAY })
    })
  })
})
