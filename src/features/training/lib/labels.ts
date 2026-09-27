import type { LucideIcon } from 'lucide-react'

import { ICONS } from '@/constants/icons'
import { ACTIVITY_TYPE_LABELS, activityLabel } from '@/features/activity/lib/activity-types'
import { WORKOUT_TYPE_LABELS, workoutLabel } from '@/features/workout/lib/workout-types'

import type { TrainingKind } from '../types'

const LABELS: Record<TrainingKind, Record<string, string>> = {
  workout: WORKOUT_TYPE_LABELS,
  activity: ACTIVITY_TYPE_LABELS,
}

/** Select options in spec order, CUSTOM last. */
export function typeOptions(kind: TrainingKind): { value: string; label: string }[] {
  return Object.entries(LABELS[kind]).map(([value, label]) => ({ value, label }))
}

export function typeLabel(kind: TrainingKind, type: string): string {
  return LABELS[kind][type] ?? type
}

/** Primary label: the record's name, else its type. */
export function recordLabel(kind: TrainingKind, type: string, name: string | null): string {
  return kind === 'workout' ? workoutLabel(type, name) : activityLabel(type, name)
}

export const KIND_ICONS: Record<TrainingKind, LucideIcon> = {
  workout: ICONS.workout,
  activity: ICONS.activity,
}

export const KIND_NOUN: Record<TrainingKind, string> = {
  workout: 'workout',
  activity: 'activity',
}
