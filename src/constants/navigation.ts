import {
  ClipboardList,
  Cpu,
  LayoutDashboard,
  ScrollText,
  UserCog,
  type LucideIcon,
} from 'lucide-react'

import { ICONS } from './icons'
import { ROUTES, type AppRoute } from './routes'

export interface NavItem {
  label: string
  to: AppRoute
  icon: LucideIcon
  /** One-line purpose, used by placeholders and page context. */
  description?: string
}

/** Primary sections (spec §8): sidebar on desktop, rail on tablet, bottom nav on mobile. */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    label: 'Home',
    to: ROUTES.home,
    icon: ICONS.home,
    description: 'Today’s nutrition, training and what to do next.',
  },
  {
    label: 'Food',
    to: ROUTES.food,
    icon: ICONS.food,
    description: 'Track meals, nutrition and daily intake.',
  },
  {
    label: 'Workout',
    to: ROUTES.workout,
    icon: ICONS.workout,
    description: 'Log sessions and follow weekly training frequency.',
  },
  {
    label: 'Progress',
    to: ROUTES.progress,
    icon: ICONS.progress,
    description: 'Body, nutrition and training trends over time.',
  },
  {
    label: 'Groups',
    to: ROUTES.groups,
    icon: ICONS.groups,
    description: 'Shared daily progress with the people you train with.',
  },
]

/** Separated from the primary sections (spec §8). */
export const PROFILE_NAV: NavItem = {
  label: 'Profile',
  to: ROUTES.profile,
  icon: ICONS.profile,
  description: 'Your details, goals and account.',
}

/** Admin entry point, shown only to ADMIN / SUPER_ADMIN (UI gating only). */
export const ADMIN_ENTRY: NavItem = { label: 'Admin', to: ROUTES.admin, icon: ICONS.admin }

/** Managers / trainers: their assigned users only (read-only). */
export const MANAGER_ENTRY: NavItem = { label: 'My users', to: ROUTES.adminUsers, icon: UserCog }

/** Admin sections (spec §78). Separate from the user navigation. */
export const ADMIN_NAV: readonly NavItem[] = [
  {
    label: 'Dashboard',
    to: ROUTES.admin,
    icon: LayoutDashboard,
    description: 'Active users, processing status, AI spend and pending reviews.',
  },
  {
    label: 'Users',
    to: ROUTES.adminUsers,
    icon: ICONS.groups,
    description: 'Create, edit and deactivate users; reset PINs.',
  },
  {
    label: 'Managers',
    to: ROUTES.adminManagers,
    icon: UserCog,
    description: 'Manager / trainer assignments.',
  },
  {
    label: 'Groups',
    to: ROUTES.adminGroups,
    icon: ICONS.goals,
    description: 'Group oversight.',
  },
  {
    label: 'Food Database',
    to: ROUTES.adminFoods,
    icon: ICONS.food,
    description: 'Shared foods, submissions, duplicates and merges.',
  },
  {
    label: 'Recommendations',
    to: ROUTES.adminProcessing,
    icon: ClipboardList,
    description: 'Monthly AI recommendation processing, readiness, AI usage and history.',
  },
  {
    label: 'AI Usage',
    to: ROUTES.adminAiUsage,
    icon: Cpu,
    description: 'Requests, tokens and cost by model, run and user.',
  },
  {
    label: 'Audit Logs',
    to: ROUTES.adminAudit,
    icon: ScrollText,
    description: 'Administrative changes and corrections.',
  },
  {
    label: 'System Settings',
    to: ROUTES.adminSettings,
    icon: ICONS.settings,
    description: 'Tolerances, AI budget and processing configuration.',
  },
]

/**
 * Staff entry point for a set of global roles (navigation only; every page and
 * action is authorized server-side).
 */
export function staffEntryFor(roles: readonly string[]): NavItem | null {
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) return ADMIN_ENTRY
  if (roles.includes('MANAGER')) return MANAGER_ENTRY
  return null
}

/** Admin sections a role can open: managers only see Users. */
export function adminNavFor(roles: readonly string[]): readonly NavItem[] {
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) return ADMIN_NAV
  return ADMIN_NAV.filter((item) => item.to === ROUTES.adminUsers)
}

/** The nav item whose section contains `pathname` (longest match wins). */
export function findNavItem(items: readonly NavItem[], pathname: string): NavItem | undefined {
  return [...items]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) =>
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    )
}
