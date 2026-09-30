import { describe, expect, it } from 'vitest'

import { correctionSchemas, createUserSchema, resetPinSchema } from '../schemas'

import {
  actionLabel,
  auditChanges,
  creatableRoles,
  friendlyAdminError,
  primaryRole,
} from './admin-logic'

describe('roles', () => {
  it('shows the highest role', () => {
    expect(primaryRole(['USER', 'MANAGER'])).toBe('MANAGER')
    expect(primaryRole(['ADMIN', 'SUPER_ADMIN'])).toBe('SUPER_ADMIN')
    expect(primaryRole([])).toBe('USER')
  })

  it('offers only the roles the server allows the actor to create', () => {
    expect(creatableRoles(['SUPER_ADMIN'])).toEqual(['USER', 'MANAGER', 'ADMIN'])
    expect(creatableRoles(['ADMIN'])).toEqual(['USER', 'MANAGER'])
    expect(creatableRoles(['MANAGER'])).toEqual([])
    expect(creatableRoles(['USER'])).toEqual([])
  })
})

describe('audit display', () => {
  it('labels profile deactivation and activation plainly', () => {
    expect(actionLabel({ action: 'DELETE', entityType: 'profiles' })).toBe('Deactivated')
    expect(actionLabel({ action: 'RESTORE', entityType: 'profiles' })).toBe('Activated')
    expect(actionLabel({ action: 'DELETE', entityType: 'meals' })).toBe('Delete')
    expect(actionLabel({ action: 'ADMIN_CORRECTION', entityType: 'steps_entries' })).toBe(
      'Admin correction',
    )
  })

  it('lists changed fields only, hiding bookkeeping and PIN material', () => {
    const changes = auditChanges({
      oldValues: { steps: 800, updated_at: 'a', note: null, pin_hash: 'x', same: 1 },
      newValues: { steps: 8000, updated_at: 'b', note: 'n', pin_hash: 'y', same: 1 },
    })
    expect(changes).toEqual([
      { field: 'steps', original: '800', corrected: '8000' },
      { field: 'note', original: '—', corrected: 'n' },
    ])
    expect(auditChanges({ oldValues: null, newValues: null })).toEqual([])
  })
})

describe('friendlyAdminError', () => {
  it('maps known server errors to plain text', () => {
    expect(friendlyAdminError({ code: '40001', message: 'x' }, 'f')).toMatch(/changed since/)
    expect(friendlyAdminError({ code: '22023', message: 'Nothing to correct' }, 'f')).toMatch(
      /Nothing changed/,
    )
    expect(friendlyAdminError({ code: 'PHONE_TAKEN' }, 'f')).toMatch(/already exists/)
    expect(
      friendlyAdminError({ code: '42501', message: 'permission denied for table x' }, 'f'),
    ).toBe('You are not allowed to do this.')
    expect(friendlyAdminError(new TypeError('fetch failed'), 'f')).toMatch(/connection/)
  })

  it('never passes through unknown raw messages', () => {
    expect(friendlyAdminError({ code: 'XX000', message: 'internal detail' }, 'Fallback')).toBe(
      'Fallback',
    )
  })
})

describe('admin schemas', () => {
  it('normalises Indian mobiles and requires a 4-digit PIN', () => {
    expect(createUserSchema.parse({ phone: '98765 43210', pin: '1234', role: 'USER' }).phone).toBe(
      '+919876543210',
    )
    expect(
      createUserSchema.safeParse({ phone: '5876543210', pin: '1234', role: 'USER' }).success,
    ).toBe(false)
    expect(
      createUserSchema.safeParse({ phone: '9876543210', pin: '12a4', role: 'USER' }).success,
    ).toBe(false)
    expect(
      createUserSchema.safeParse({ phone: '9876543210', pin: '1234', role: 'SUPER_ADMIN' }).success,
    ).toBe(false)
  })

  it('treats a blank reason as none', () => {
    expect(resetPinSchema.parse({ pin: '4321', reason: '  ' })).toEqual({
      pin: '4321',
      reason: null,
    })
  })

  it('validates correction values like the database', () => {
    expect(correctionSchemas.steps.parse('8000')).toBe(8000)
    expect(correctionSchemas.steps.safeParse('80.5').success).toBe(false)
    expect(correctionSchemas.weight.safeParse('19').success).toBe(false)
    expect(correctionSchemas.bodyFat.parse('')).toBeNull()
    expect(correctionSchemas.height.safeParse('251').success).toBe(false)
  })
})
