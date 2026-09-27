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
