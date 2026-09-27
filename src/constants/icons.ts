import {
  Activity,
  BicepsFlexed,
  ChartLine,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  House,
  Leaf,
  Scale,
  Settings,
  ShieldUser,
  Target,
  User,
  Users,
  Utensils,
  Wheat,
  type LucideIcon,
} from 'lucide-react'

/**
 * Domain → icon mapping (spec §2 "Icons"). One outline family: lucide-react.
 * Always reference concepts through this map so the mapping stays consistent.
 *
 * Note: lucide has no running-figure icon, so `activity` uses the pulse icon.
 */
export const ICONS = {
  home: House,
  food: Utensils,
  calories: Flame,
  protein: BicepsFlexed,
  carbs: Wheat,
  fat: Droplet,
  fiber: Leaf,
  steps: Footprints,
  workout: Dumbbell,
  activity: Activity,
  weight: Scale,
  progress: ChartLine,
  goals: Target,
  groups: Users,
  profile: User,
  settings: Settings,
  admin: ShieldUser,
} as const satisfies Record<string, LucideIcon>

export type IconKey = keyof typeof ICONS
