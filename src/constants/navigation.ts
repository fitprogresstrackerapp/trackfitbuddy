import type { LucideIcon } from 'lucide-react'

import { ICONS } from './icons'
import { ROUTES, type AppRoute } from './routes'

export interface NavItem {
  label: string
  to: AppRoute
  icon: LucideIcon
}

/** Primary sections (spec §8). Mobile bottom nav + desktop sidebar. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: 'Home', to: ROUTES.home, icon: ICONS.home },
  { label: 'Food', to: ROUTES.food, icon: ICONS.food },
  { label: 'Workout', to: ROUTES.workout, icon: ICONS.workout },
  { label: 'Progress', to: ROUTES.progress, icon: ICONS.progress },
  { label: 'Groups', to: ROUTES.groups, icon: ICONS.groups },
]

/** Shown below the divider on desktop; top-right control on mobile. */
export const PROFILE_NAV: NavItem = {
  label: 'Profile',
  to: ROUTES.profile,
  icon: ICONS.profile,
}
