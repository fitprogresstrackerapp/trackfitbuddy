import type { AppRole } from '../types'

/** Roles that may open the admin area. UI gating only — RLS is authoritative. */
export const ADMIN_ROLES: readonly AppRole[] = ['SUPER_ADMIN', 'ADMIN']

/** Roles that may open the admin area at all (managers: their assigned users only). */
export const STAFF_ROLES: readonly AppRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER']

export function hasAnyRole(roles: readonly AppRole[], allowed: readonly AppRole[]): boolean {
  return roles.some((role) => allowed.includes(role))
}
