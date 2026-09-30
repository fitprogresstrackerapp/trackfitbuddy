import { describe, expect, it } from 'vitest'

import type { MemberDay } from '../api/groups-data'
import { createGroupSchema, joinCodeSchema } from '../schemas'
import {
  formatGroupCode,
  friendlyGroupError,
  groupPath,
  isPlausibleGroupCode,
  leaveOutcome,
  memberCardView,
  normalizeGroupCode,
  permissionsFor,
  ROLE_LABELS,
} from './groups-logic'

const day = (overrides: Partial<MemberDay>): MemberDay => ({
  userId: 'u',
  name: 'Ben',
  role: 'MEMBER',
  calories: null,
  caloriesTarget: null,
  proteinG: null,
  proteinTargetG: null,
  steps: null,
  stepsTarget: null,
  workoutLogged: false,
  ...overrides,
})

describe('join codes', () => {
  it('normalises like the server: case, spaces and dashes are ignored', () => {
    expect(normalizeGroupCode(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normalizeGroupCode('ab cd\tef-gh')).toBe('ABCDEFGH')
  })

  it('checks only the shape; existence is decided by the server', () => {
    expect(isPlausibleGroupCode('ABCDEFGH')).toBe(true)
    expect(isPlausibleGroupCode('ABC')).toBe(false)
    expect(isPlausibleGroupCode('ABCD EFGH')).toBe(false)
    expect(isPlausibleGroupCode('ABCDEFGH!')).toBe(false)
  })

  it('is shown in two readable halves', () => {
    expect(formatGroupCode('ABCDEFGH')).toBe('ABCD-EFGH')
    expect(formatGroupCode('ABCDEF')).toBe('ABCDEF')
  })

  it('the join form normalises and validates the code', () => {
    expect(joinCodeSchema.parse({ code: 'abcd-efgh' })).toEqual({ code: 'ABCDEFGH' })
    expect(joinCodeSchema.safeParse({ code: '   ' }).error?.issues[0]?.message).toBe(
      'Enter the group code',
    )
    expect(joinCodeSchema.safeParse({ code: 'ab' }).success).toBe(false)
  })
})

describe('group creation input', () => {
  it('trims, requires a name and treats a blank description as none', () => {
    expect(createGroupSchema.parse({ name: '  Morning crew ', description: '  ' })).toEqual({
      name: 'Morning crew',
      description: null,
    })
    expect(createGroupSchema.safeParse({ name: '   ', description: '' }).success).toBe(false)
    expect(createGroupSchema.safeParse({ name: 'x'.repeat(61), description: '' }).success).toBe(
      false,
    )
    expect(
      createGroupSchema.safeParse({ name: 'Crew', description: 'x'.repeat(501) }).success,
    ).toBe(false)
  })
})

describe('roles', () => {
  it('group roles are separate and simple', () => {
    expect(ROLE_LABELS).toEqual({ ADMIN: 'Group admin', LEADER: 'Group leader', MEMBER: 'Member' })
    expect(permissionsFor('ADMIN')).toEqual({
      canRemoveMembers: true,
      canChangeRoles: true,
      hasExtendedHistory: true,
    })
    expect(permissionsFor('LEADER')).toEqual({
      canRemoveMembers: false,
      canChangeRoles: false,
      hasExtendedHistory: true,
    })
    expect(permissionsFor('MEMBER')).toEqual({
      canRemoveMembers: false,
      canChangeRoles: false,
      hasExtendedHistory: false,
    })
  })

  it('the only admin must appoint another before leaving; the last member closes the group', () => {
    const admin = { role: 'ADMIN' as const }
    const member = { role: 'MEMBER' as const }
    expect(leaveOutcome('ADMIN', [admin])).toEqual({ kind: 'last-member' })
    expect(leaveOutcome('ADMIN', [admin, member])).toEqual({ kind: 'needs-another-admin' })
    expect(leaveOutcome('ADMIN', [admin, admin, member])).toEqual({ kind: 'leave' })
    expect(leaveOutcome('MEMBER', [admin, member])).toEqual({ kind: 'leave' })
    expect(leaveOutcome('LEADER', [admin, { role: 'LEADER' }])).toEqual({ kind: 'leave' })
  })

  it('builds the group route', () => {
    expect(groupPath('abc')).toBe('/groups/abc')
  })
})

describe('member card metrics', () => {
  it('shows actual against the member’s own target', () => {
    const view = memberCardView(
      day({
        calories: 1650.4,
        caloriesTarget: 2000,
        proteinG: 117.6,
        proteinTargetG: 140,
        steps: 7842,
        workoutLogged: true,
      }),
    )
    expect(view).toEqual({
      calories: { actual: 1650, target: 2000 },
      protein: { actual: 118, target: 140 },
      steps: { actual: 7842, target: null },
      workout: 'done',
      empty: false,
    })
  })

  it('missing data stays missing (null), never zero', () => {
    const view = memberCardView(day({ caloriesTarget: 2000, proteinTargetG: 140 }))
    expect(view.calories).toEqual({ actual: null, target: 2000 })
    expect(view.protein).toEqual({ actual: null, target: 140 })
    expect(view.steps).toEqual({ actual: null, target: null })
    expect(view.workout).toBe('none')
    expect(view.empty).toBe(true)
  })

  it('no step goal means no step target (never 0 / 0); one would be shown if it existed', () => {
    expect(memberCardView(day({ steps: 5000 })).steps).toEqual({ actual: 5000, target: null })
    expect(memberCardView(day({ steps: 5000, stepsTarget: 8000 })).steps).toEqual({
      actual: 5000,
      target: 8000,
    })
  })

  it('a logged 0 is a real value, not missing', () => {
    expect(memberCardView(day({ calories: 0 })).calories.actual).toBe(0)
  })
})

describe('errors', () => {
  it('maps server errors to plain words, never raw messages', () => {
    expect(friendlyGroupError({ code: 'P0002', message: 'Invalid group code' }, 'x')).toMatch(
      /doesn’t match a group/,
    )
    expect(
      friendlyGroupError(
        { code: 'P0001', message: 'Make another member a group admin first' },
        'x',
      ),
    ).toBe('Make another member a group admin before leaving.')
    expect(
      friendlyGroupError({ code: 'XX000', message: 'relation "x" does not exist' }, 'Fallback'),
    ).toBe('Fallback')
  })
})
