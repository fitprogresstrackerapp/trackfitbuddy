import type { Json } from '@/types/database'

import type { AppRole, AuditAction, AuditEntry, RecommendationStatus } from '../api/admin-data'

/*
 * Pure display rules for the admin area. Authorization is never decided here:
 * the server answers (e.g. UserAccount.canAdminister) and enforces every
 * action. These helpers only label and format.
 */

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  USER: 'User',
}

const ROLE_ORDER: readonly AppRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER']

/** The highest global role, shown in tables. */
export function primaryRole(roles: readonly AppRole[]): AppRole {
  return ROLE_ORDER.find((role) => roles.includes(role)) ?? 'USER'
}

/** Roles an actor may give a new account (the server applies the same rule). */
export function creatableRoles(actorRoles: readonly AppRole[]): ('USER' | 'MANAGER' | 'ADMIN')[] {
  if (actorRoles.includes('SUPER_ADMIN')) return ['USER', 'MANAGER', 'ADMIN']
  if (actorRoles.includes('ADMIN')) return ['USER', 'MANAGER']
  return []
}

export const RECOMMENDATION_LABELS: Record<RecommendationStatus, string> = {
  IN_REVIEW: 'In review',
  ACTIVE: 'Active',
  NONE: 'None',
}

export const ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  RESTORE: 'Restore',
  LOCK: 'Lock',
  UNLOCK: 'Unlock',
  PIN_RESET: 'PIN reset',
  ROLE_CHANGE: 'Role change',
  ADMIN_CORRECTION: 'Admin correction',
}

/** Audit domains (entity_type) that the filter offers, with readable names. */
export const DOMAIN_LABELS: Record<string, string> = {
  profiles: 'Account / profile',
  user_pins: 'PIN',
  user_roles: 'Roles',
  meals: 'Meals',
  meal_items: 'Meal items',
  workouts: 'Workouts',
  activities: 'Activities',
  steps_entries: 'Steps',
  weight_measurements: 'Weight',
  inbody_reports: 'InBody reports',
  inbody_metrics: 'InBody metrics',
  goals: 'Goals',
  recommendation_cycles: 'Recommendations',
  recommendation_feedback: 'Feedback',
  groups: 'Groups',
  group_memberships: 'Group membership',
  system_settings: 'Settings',
  food_items: 'Food database',
}

export const domainLabel = (entity: string) => DOMAIN_LABELS[entity] ?? entity

/** Profile deactivation is stored as DELETE / RESTORE on the profile. */
export function actionLabel(entry: Pick<AuditEntry, 'action' | 'entityType'>): string {
  if (entry.entityType === 'profiles' && entry.action === 'DELETE') return 'Deactivated'
  if (entry.entityType === 'profiles' && entry.action === 'RESTORE') return 'Activated'
  return ACTION_LABELS[entry.action]
}

// Bookkeeping columns carry no meaning for a reader.
const HIDDEN_FIELDS = new Set([
  'updated_at',
  'created_at',
  'locked_at',
  'deleted_at',
  'deleted_by',
  'deactivated_by',
  'final_calories',
  'pin_hash',
])

export interface FieldChange {
  field: string
  original: string
  corrected: string
}

function display(value: Json | undefined): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const fieldLabel = (key: string) => key.replace(/_/g, ' ')

/** Field / original / corrected lines for an audit entry. */
export function auditChanges(entry: Pick<AuditEntry, 'oldValues' | 'newValues'>): FieldChange[] {
  const record = (value: Json | null): Record<string, Json | undefined> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const before = record(entry.oldValues)
  const after = record(entry.newValues)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .filter((key) => display(before[key]) !== display(after[key]))
    .map((key) => ({
      field: fieldLabel(key),
      original: display(before[key]),
      corrected: display(after[key]),
    }))
}

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  date_of_birth: 'Date of birth',
  gender: 'Gender',
  height_cm: 'Height',
  current_weight: 'Current weight',
}

const KNOWN_ERRORS: readonly [RegExp, string][] = [
  [
    /changed since you opened it/i,
    'This record changed since you opened it. Refresh and try again.',
  ],
  [/nothing to correct/i, 'Nothing changed. Edit a value to correct it.'],
  [/not allowed to administer/i, 'You are not allowed to change this account.'],
  [/last active super admin/i, 'The last active super admin cannot be deactivated.'],
  [/InBody weights are corrected/i, 'InBody weights are corrected through the InBody metrics.'],
  [/already (active|inactive)/i, 'The account already has this status.'],
]

const ACTION_CODES: Record<string, string> = {
  PHONE_TAKEN: 'A user with this phone number already exists.',
  FORBIDDEN: 'You are not allowed to do this.',
  NOT_FOUND: 'That user no longer exists.',
  INVALID_INPUT: 'Check the values and try again.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again.',
}

/** Admin-facing text; never raw database or provider messages. */
export function friendlyAdminError(error: unknown, fallback: string): string {
  if (error instanceof TypeError)
    return 'Couldn’t reach the server. Check your connection and try again.'
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (typeof code === 'string' && code in ACTION_CODES) return ACTION_CODES[code] ?? fallback
    if (typeof message === 'string') {
      const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(message))
      if (known) return known[1]
    }
    if (code === '40001') return 'This record changed since you opened it. Refresh and try again.'
    if (code === '42501') return 'You are not allowed to do this.'
    if (code === '22023' && typeof message === 'string' && message.length < 120) return message
    if (code === '23514') return 'One of the values is not allowed.'
  }
  return fallback
}
