/** Display labels for goals (spec §22; values match the database CHECK lists). */
export const LONG_TERM_GOAL_LABELS: Record<string, string> = {
  FAT_LOSS: 'Fat loss',
  MUSCLE_GAIN: 'Muscle gain',
  GENERAL_FITNESS: 'General fitness',
  PERFORMANCE: 'Performance',
}

export const FOCUS_LABELS: Record<string, string> = {
  MUSCLE_BUILDING: 'Muscle building',
  RECOMPOSITION: 'Recomposition',
  CRICKET_PERFORMANCE: 'Cricket performance',
  BADMINTON_PERFORMANCE: 'Badminton performance',
  FLEXIBILITY: 'Flexibility',
  ENDURANCE: 'Endurance',
  GENERAL_FITNESS: 'General fitness',
}

export const longTermGoalLabel = (value: string) => LONG_TERM_GOAL_LABELS[value] ?? value
export const focusLabel = (value: string) => FOCUS_LABELS[value] ?? value

/** Allowed values, in display order (the database CHECK lists). */
export const LONG_TERM_GOALS = [
  'FAT_LOSS',
  'MUSCLE_GAIN',
  'GENERAL_FITNESS',
  'PERFORMANCE',
] as const
export const FOCUS_TYPES = [
  'MUSCLE_BUILDING',
  'RECOMPOSITION',
  'CRICKET_PERFORMANCE',
  'BADMINTON_PERFORMANCE',
  'FLEXIBILITY',
  'ENDURANCE',
  'GENERAL_FITNESS',
] as const

export type LongTermGoal = (typeof LONG_TERM_GOALS)[number]
export type FocusType = (typeof FOCUS_TYPES)[number]

/** Activity level (spec §23, optional profile context). */
export const ACTIVITY_LEVEL_LABELS: Record<string, string> = {
  SEDENTARY: 'Sedentary',
  LIGHTLY_ACTIVE: 'Lightly active',
  MODERATELY_ACTIVE: 'Moderately active',
  VERY_ACTIVE: 'Very active',
  EXTREMELY_ACTIVE: 'Extremely active',
}
