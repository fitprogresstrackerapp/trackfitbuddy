/** Display labels for workout types (spec §14; values match the database CHECK list). */
export const WORKOUT_TYPE_LABELS: Record<string, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  SHOULDERS: 'Shoulders',
  BICEPS: 'Biceps',
  TRICEPS: 'Triceps',
  LEGS: 'Legs',
  CHEST_TRICEPS: 'Chest + Triceps',
  BACK_BICEPS: 'Back + Biceps',
  SHOULDERS_ARMS: 'Shoulders + Arms',
  UPPER_BODY: 'Upper body',
  LOWER_BODY: 'Lower body',
  FULL_BODY: 'Full body',
  HIIT: 'HIIT',
  CARDIO: 'Cardio',
  ATHLETIC_PERFORMANCE: 'Athletic / Performance',
  CUSTOM: 'Custom',
}

export function workoutLabel(type: string, customName: string | null): string {
  if (type === 'CUSTOM' && customName) return customName
  return WORKOUT_TYPE_LABELS[type] ?? type
}
